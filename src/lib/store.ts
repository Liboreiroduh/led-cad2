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
const REVISIONS_FILE = path.join(DATA_DIR, "revisions.json");
const MAX_REVISION_LOG = 40;
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

export type RevisionSource = "init" | "ai_apply" | "manual_json" | "import" | "preset" | "undo" | "restore" | "new" | "rename";

export interface RevisionLogEntry {
  revision: number;
  hash: string;
  saved_at: string;
  source: RevisionSource;
  note: string;
  element_count: number;
  panel: { width: number; height: number } | null;
  project: ProjectDocument;
}

export interface RevisionListItem {
  revision: number;
  hash: string;
  saved_at: string;
  source: RevisionSource;
  note: string;
  element_count: number;
  panel: { width: number; height: number } | null;
  is_current: boolean;
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

export interface ListedExample extends ExampleEntry {
  id: string;
  before_elements: number;
  after_elements: number;
  size_bytes: number;
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
  revisionLog: RevisionLogEntry[];
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
    this.revisionLog = readJson<RevisionLogEntry[]>(REVISIONS_FILE, []);
    if (!Array.isArray(this.revisionLog)) this.revisionLog = [];
    this.revisionLog = this.revisionLog.slice(-MAX_REVISION_LOG);
    // garante entrada da revisão atual no log (boot antigo ou log corrompido)
    if (!this.revisionLog.some((r) => r.revision === this.state.revision && r.hash === this.state.hash)) {
      this.revisionLog.push(this.makeLogEntry(this.state.revision, this.state.project, "init", "estado carregado"));
      if (this.revisionLog.length > MAX_REVISION_LOG) this.revisionLog = this.revisionLog.slice(-MAX_REVISION_LOG);
    }
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
    writeJsonAtomic(REVISIONS_FILE, this.revisionLog);
  }

  private makeLogEntry(revision: number, project: ProjectDocument, source: RevisionSource, note: string): RevisionLogEntry {
    const panel = project.panel
      ? { width: project.panel.width, height: project.panel.height }
      : null;
    return {
      revision,
      hash: projectHash(project),
      saved_at: new Date().toISOString(),
      source,
      note,
      element_count: project.elements?.length ?? 0,
      panel,
      project,
    };
  }

  snapshotCurrent(): UndoEntry {
    return {
      revision: this.state.revision,
      hash: this.state.hash,
      project: this.state.project,
      saved_at: new Date().toISOString(),
    };
  }

  /** Substitui o projeto atual (com snapshot para undo + log de revisão). */
  private replace(
    project: ProjectDocument,
    source: RevisionSource = "manual_json",
    note = "",
  ): PersistShape {
    this.undoStack.push(this.snapshotCurrent());
    if (this.undoStack.length > 25) this.undoStack = this.undoStack.slice(-25);
    const now = new Date().toISOString();
    const revision = this.state.revision + 1;
    this.state = {
      revision,
      project,
      hash: projectHash(project),
      saved_at: now,
      updated_at: now,
    };
    this.revisionLog.push(this.makeLogEntry(revision, project, source, note));
    if (this.revisionLog.length > MAX_REVISION_LOG) this.revisionLog = this.revisionLog.slice(-MAX_REVISION_LOG);
    this.persistAll();
    return this.state;
  }

  checkConflict(baseRevision: number, baseHash: string): void {
    if (this.state.revision !== baseRevision || this.state.hash !== baseHash) {
      throw new ConflictError();
    }
  }

  applyCandidate(
    candidate: ProjectDocument,
    baseRevision: number,
    baseHash: string,
    source: RevisionSource = "ai_apply",
    note = "",
  ): PersistShape {
    this.checkConflict(baseRevision, baseHash);
    return this.replace(candidate, source, note);
  }

  /** Renomeia o projeto (metadata.name) como revisão própria — undo-able. */
  renameProject(name: string, baseRevision: number, baseHash: string): PersistShape {
    this.checkConflict(baseRevision, baseHash);
    const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!trimmed) throw new Error("nome do projeto não pode ficar vazio");
    if (trimmed === this.state.project.project.name) {
      // nada a fazer — devolve estado atual sem criar revisão inútil
      return this.state;
    }
    const next = structuredClone(this.state.project);
    next.project.name = trimmed;
    return this.replace(next, "rename", `projeto renomeado para “${trimmed}”`);
  }

  applyValidatedRaw(
    raw: unknown,
    source: ProjectDocument["metadata"]["source"],
    revSource: RevisionSource = "import",
    note = "documento importado",
  ): PersistShape {
    const result = parseProject(raw);
    if (!result.ok) {
      const err = new Error("documento inválido") as Error & { issues?: ValidationIssue[] };
      err.issues = result.errors;
      throw err;
    }
    return this.replace(result.project, revSource, note);
  }

  undo(): PersistShape | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    const now = new Date().toISOString();
    const revision = this.state.revision + 1;
    this.state = {
      revision,
      project: prev.project,
      hash: projectHash(prev.project),
      saved_at: prev.saved_at,
      updated_at: now,
    };
    this.revisionLog.push(this.makeLogEntry(revision, prev.project, "undo", `desfeito → rev ${prev.revision}`));
    if (this.revisionLog.length > MAX_REVISION_LOG) this.revisionLog = this.revisionLog.slice(-MAX_REVISION_LOG);
    this.persistAll();
    return this.state;
  }

  // ---------- Revision history ----------
  listRevisions(): RevisionListItem[] {
    return [...this.revisionLog]
      .sort((a, b) => b.revision - a.revision)
      .map((r) => ({
        revision: r.revision,
        hash: r.hash,
        saved_at: r.saved_at,
        source: r.source,
        note: r.note,
        element_count: r.element_count,
        panel: r.panel,
        is_current: r.revision === this.state.revision && r.hash === this.state.hash,
      }));
  }

  getRevision(revision: number): RevisionLogEntry | null {
    return this.revisionLog.find((r) => r.revision === revision) ?? null;
  }

  /** Restaura o documento de uma revisão antiga como NOVA revisão (com snapshot p/ undo). */
  restoreRevision(revision: number, baseRevision: number, baseHash: string): PersistShape {
    const entry = this.getRevision(revision);
    if (!entry) throw new Error(`revisão ${revision} não encontrada no histórico`);
    this.checkConflict(baseRevision, baseHash);
    return this.replace(entry.project, "restore", `restaurada da rev ${revision}`);
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
    return this.replace(doc, "preset", `preset ${id} carregado`);
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

  // ---------- Examples (few-shot) ----------
  saveExample(entry: Omit<ExampleEntry, "saved_at">): string {
    ensureDirs();
    const id = `${Date.now()}-${newProjectId()}`;
    const full: ExampleEntry = { ...entry, saved_at: new Date().toISOString() };
    writeJsonAtomic(path.join(EXAMPLES_DIR, `${id}.json`), full);
    return id;
  }

  /** Lista os exemplos salvos (mais recentes primeiro) para few-shot e UI. */
  listExamples(): ListedExample[] {
    ensureDirs();
    const out: ListedExample[] = [];
    try {
      for (const f of fs.readdirSync(EXAMPLES_DIR)) {
        if (!f.endsWith(".json")) continue;
        const file = path.join(EXAMPLES_DIR, f);
        const raw = readJson<(ExampleEntry & { project?: unknown }) | null>(file, null);
        if (!raw || typeof raw.request !== "string") continue;
        const beforeDoc = (raw.before as { elements?: unknown[] } | null) ?? null;
        const afterDoc = (raw.after as { elements?: unknown[] } | null) ?? null;
        out.push({
          id: f.replace(/\.json$/, ""),
          request: raw.request,
          before: raw.before,
          after: raw.after,
          operator_note: raw.operator_note ?? "",
          saved_at: raw.saved_at ?? new Date(0).toISOString(),
          before_elements: Array.isArray(beforeDoc?.elements) ? beforeDoc!.elements!.length : 0,
          after_elements: Array.isArray(afterDoc?.elements) ? afterDoc!.elements!.length : 0,
          size_bytes: Buffer.byteLength(JSON.stringify(raw), "utf8"),
        });
      }
    } catch {
      // dir ausente
    }
    return out.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  }

  /** Remove um exemplo few-shot por id (sem extensão). Retorna false se não existir. */
  deleteExample(id: string): boolean {
    // sanitiza: só nome de arquivo seguro (sem path traversal)
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;
    const file = path.join(EXAMPLES_DIR, `${id}.json`);
    try {
      if (!fs.existsSync(file)) return false;
      fs.rmSync(file);
      return true;
    } catch {
      return false;
    }
  }
}

const globalStore = globalThis as unknown as { __ledCadStore?: ProjectStore; __ledCadStoreV?: number };

/**
 * Versão da "forma" da classe ProjectStore em memória.
 * O singleton vive em globalThis para sobreviver entre módulos, mas em dev o HMR
 * recompila a classe sem recriar a instância — instância antiga fica sem métodos novos
 * ("store.listRevisions is not a function"). Bumpar STORE_VERSION ao mudar a classe
 * força a recriação segura (todo estado é persistido em data/*.json e recarregado).
 */
const STORE_VERSION = 6;

export function getStore(): ProjectStore {
  if (!globalStore.__ledCadStore || globalStore.__ledCadStoreV !== STORE_VERSION) {
    globalStore.__ledCadStore = new ProjectStore();
    globalStore.__ledCadStoreV = STORE_VERSION;
  }
  return globalStore.__ledCadStore;
}
