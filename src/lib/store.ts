/**
 * PROJECT STORE — estado único do projeto no servidor.
 * Persistência local em data/ (write-through) + cache em memória.
 *  - revision + project_hash (SHA-256 do JSON canônico)
 *  - undo atômico por snapshot do JSON anterior
 *  - config de IA em data/ai_config.json (chaves NUNCA vão ao frontend)
 */
import fs from "fs";
import path from "path";
import { projectHash, newProjectId } from "./cad/hashing";
import { blankProject } from "./cad/blank";
import { referencePresets, presetList } from "./cad/presets";
import { parseProject, validateProject, type ValidationIssue } from "./cad/validation";
import type { ProjectDocument } from "./cad/schema";

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECT_FILE = path.join(DATA_DIR, "project.json");
const UNDO_FILE = path.join(DATA_DIR, "undo.json");
const AI_CONFIG_FILE = path.join(DATA_DIR, "ai_config.json");
const CUSTOM_PRESETS_DIR = path.join(DATA_DIR, "presets", "custom");
const EXAMPLES_DIR = path.join(DATA_DIR, "examples");

export class ConflictError extends Error {
  constructor(message = "project changed") {
    super(message);
    this.name = "ConflictError";
  }
}

export interface UndoEntry {
  revision: number;
  hash: string;
  project: ProjectDocument;
  saved_at: string;
}

export interface ProviderConfig {
  model: string;
  api_key: string;
  timeout_ms: number;
}

export interface AiConfig {
  active_provider: "gemini" | "zai" | "mock";
  gemini: ProviderConfig;
  zai: ProviderConfig;
  mock: { model: string };
}

export interface ExampleEntry {
  request: string;
  before: unknown;
  after: unknown;
  operator_note: string;
  saved_at: string;
}

interface PersistShape {
  revision: number;
  project: ProjectDocument;
  hash: string;
  saved_at: string;
  updated_at: string;
}

function ensureDirs(): void {
  for (const dir of [DATA_DIR, CUSTOM_PRESETS_DIR, EXAMPLES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const DEFAULT_AI_CONFIG: AiConfig = {
  active_provider: "mock",
  gemini: { model: "gemini-2.5-flash", api_key: "", timeout_ms: 90000 },
  zai: { model: "glm-4.5-flash", api_key: "", timeout_ms: 120000 },
  mock: { model: "mock-transformer-v1" },
};

class ProjectStore {
  state: PersistShape;
  undoStack: UndoEntry[];
  aiConfig: AiConfig;
  pendingPreviews = new Map<
    string,
    { candidate: ProjectDocument; base_revision: number; base_hash: string; created_at: number }
  >();

  constructor() {
    ensureDirs();
    const persisted = readJson<PersistShape | null>(PROJECT_FILE, null);
    if (persisted && persisted.project) {
      const check = validateProject(persisted.project);
      if (check.ok) {
        this.state = {
          revision: persisted.revision ?? 1,
          project: persisted.project,
          hash: check.hash,
          saved_at: persisted.saved_at ?? new Date().toISOString(),
          updated_at: persisted.updated_at ?? new Date().toISOString(),
        };
      } else {
        this.state = this.freshState();
      }
    } else {
      // Primeiro boot: carrega preset de referência para demonstração imediata
      const preset = referencePresets().get("REF_4000X2000")!;
      this.state = this.freshState(preset);
    }
    this.undoStack = readJson<UndoEntry[]>(UNDO_FILE, []);
    if (!Array.isArray(this.undoStack)) this.undoStack = [];
    this.undoStack = this.undoStack.slice(-25);
    const cfg = readJson<AiConfig | null>(AI_CONFIG_FILE, null);
    this.aiConfig = { ...DEFAULT_AI_CONFIG, ...(cfg ?? {}) };
    if (!this.aiConfig.gemini) this.aiConfig.gemini = DEFAULT_AI_CONFIG.gemini;
    if (!this.aiConfig.zai) this.aiConfig.zai = DEFAULT_AI_CONFIG.zai;
    if (!this.aiConfig.mock) this.aiConfig.mock = DEFAULT_AI_CONFIG.mock;

    // .env pode pré-configurar chaves (server-side apenas)
    if (!this.aiConfig.zai.api_key && process.env.ZAI_API_KEY) {
      this.aiConfig.zai.api_key = process.env.ZAI_API_KEY;
    }
    if (!this.aiConfig.gemini.api_key && process.env.GEMINI_API_KEY) {
      this.aiConfig.gemini.api_key = process.env.GEMINI_API_KEY;
    }
    this.persistAll();
  }

  private freshState(doc?: ProjectDocument): PersistShape {
    const project = doc ?? blankProject();
    const now = new Date().toISOString();
    return { revision: 1, project, hash: projectHash(project), saved_at: now, updated_at: now };
  }

  private persistAll(): void {
    writeJsonAtomic(PROJECT_FILE, this.state);
    writeJsonAtomic(UNDO_FILE, this.undoStack);
    writeJsonAtomic(AI_CONFIG_FILE, this.aiConfig);
  }

  snapshotCurrent(): UndoEntry {
    return {
      revision: this.state.revision,
      hash: this.state.hash,
      project: this.state.project,
      saved_at: new Date().toISOString(),
    };
  }

  /** Substitui o projeto atual (com snapshot para undo). */
  private replace(project: ProjectDocument, note?: string): PersistShape {
    this.undoStack.push(this.snapshotCurrent());
    if (this.undoStack.length > 25) this.undoStack = this.undoStack.slice(-25);
    const now = new Date().toISOString();
    this.state = {
      revision: this.state.revision + 1,
      project,
      hash: projectHash(project),
      saved_at: now,
      updated_at: now,
    };
    if (note) this.state.saved_at = now;
    this.persistAll();
    return this.state;
  }

  checkConflict(baseRevision: number, baseHash: string): void {
    if (this.state.revision !== baseRevision || this.state.hash !== baseHash) {
      throw new ConflictError();
    }
  }

  applyCandidate(candidate: ProjectDocument, baseRevision: number, baseHash: string): PersistShape {
    this.checkConflict(baseRevision, baseHash);
    return this.replace(candidate);
  }

  applyValidatedRaw(raw: unknown, source: ProjectDocument["metadata"]["source"]): PersistShape {
    const result = parseProject(raw);
    if (!result.ok) {
      const err = new Error("documento inválido") as Error & { issues?: ValidationIssue[] };
      err.issues = result.errors;
      throw err;
    }
    return this.replace(result.project);
  }

  undo(): PersistShape | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    const now = new Date().toISOString();
    this.state = {
      revision: this.state.revision + 1,
      project: prev.project,
      hash: projectHash(prev.project),
      saved_at: prev.saved_at,
      updated_at: now,
    };
    this.persistAll();
    return this.state;
  }

  // ---------- Presets ----------
  listPresets() {
    const custom: Array<{ id: string; name: string; description: string }> = [];
    try {
      for (const f of fs.readdirSync(CUSTOM_PRESETS_DIR)) {
        if (!f.endsWith(".json")) continue;
        const raw = readJson<{ id?: string; name?: string; description?: string } | null>(
          path.join(CUSTOM_PRESETS_DIR, f),
          null,
        );
        const doc = raw as unknown as ProjectDocument | null;
        if (doc && doc.project) {
          custom.push({
            id: doc.project.id || f.replace(".json", ""),
            name: doc.project.name || f,
            description: doc.project.description || "",
          });
        }
      }
    } catch {
      // dir vazio
    }
    return { references: presetList(), custom };
  }

  getPresetDoc(id: string): ProjectDocument | null {
    const ref = referencePresets().get(id);
    if (ref) return ref;
    const file = path.join(CUSTOM_PRESETS_DIR, `${id.replace(/[^\w-]/g, "")}.json`);
    const raw = readJson<unknown>(file, null);
    if (!raw) return null;
    const parsed = parseProject(raw);
    return parsed.ok ? parsed.project : null;
  }

  loadPreset(id: string): PersistShape {
    const doc = this.getPresetDoc(id);
    if (!doc) throw new Error(`preset não encontrado: ${id}`);
    return this.replace(doc);
  }

  saveCustomPreset(project: ProjectDocument): { id: string } {
    const safe = parseProject(project);
    if (!safe.ok) {
      throw new Error("projeto inválido para salvar como preset");
    }
    const doc = safe.project;
    const file = path.join(CUSTOM_PRESETS_DIR, `${doc.project.id.replace(/[^\w-]/g, "")}.json`);
    writeJsonAtomic(file, doc);
    return { id: doc.project.id };
  }

  // ---------- AI config ----------
  getAiConfig(): AiConfig {
    return this.aiConfig;
  }

  updateAiConfig(patch: {
    provider?: AiConfig["active_provider"];
    model?: string;
    api_key?: string;
    timeout_ms?: number;
    target?: "gemini" | "zai";
  }): AiConfig {
    if (patch.target && (patch.model !== undefined || patch.timeout_ms !== undefined)) {
      const target = this.aiConfig[patch.target];
      if (patch.model) target.model = patch.model;
      if (patch.timeout_ms) target.timeout_ms = patch.timeout_ms;
    }
    if (patch.target && patch.api_key !== undefined) {
      this.aiConfig[patch.target].api_key = patch.api_key;
    }
    if (patch.provider) this.aiConfig.active_provider = patch.provider;
    writeJsonAtomic(AI_CONFIG_FILE, this.aiConfig);
    return this.aiConfig;
  }

  // ---------- Pending previews ----------
  putPendingPreview(
    candidate: ProjectDocument,
    base_revision: number,
    base_hash: string,
  ): string {
    const hash = projectHash(candidate);
    this.pendingPreviews.set(hash, {
      candidate,
      base_revision,
      base_hash,
      created_at: Date.now(),
    });
    // limpa previews antigos (> 1h)
    const now = Date.now();
    for (const [k, v] of this.pendingPreviews) {
      if (now - v.created_at > 3600_000) this.pendingPreviews.delete(k);
    }
    return hash;
  }

  // ---------- Examples (few-shot futuros) ----------
  saveExample(entry: Omit<ExampleEntry, "saved_at">): string {
    ensureDirs();
    const id = `${Date.now()}-${newProjectId()}.json`;
    const full: ExampleEntry = { ...entry, saved_at: new Date().toISOString() };
    writeJsonAtomic(path.join(EXAMPLES_DIR, id), full);
    return id;
  }
}

const globalStore = globalThis as unknown as { __ledCadStore?: ProjectStore };

export function getStore(): ProjectStore {
  if (!globalStore.__ledCadStore) {
    globalStore.__ledCadStore = new ProjectStore();
  }
  return globalStore.__ledCadStore;
}
