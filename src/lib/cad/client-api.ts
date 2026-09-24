/** Cliente tipado das APIs do LED JSON CAD (frontend). */
import type { ProjectDocument, ProjectDiff, Assumption } from "./schema";

export interface ProjectState {
  revision: number;
  hash: string;
  saved_at?: string;
  updated_at?: string;
  can_undo?: boolean;
  project: ProjectDocument;
}

export interface ApiError {
  type: string;
  message: string;
  provider?: string;
  retryable?: boolean;
  details?: unknown;
}

export class ApiCallError extends Error {
  payload: ApiError;
  status: number;
  constructor(payload: ApiError, status: number) {
    super(payload.message);
    this.payload = payload;
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiCallError({ type: "network", message: "Falha de rede — verifique a conexão com o servidor." }, 0);
  }
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const payload = (body as { error?: ApiError })?.error ?? { type: "http_error", message: `HTTP ${res.status}` };
    throw new ApiCallError(payload, res.status);
  }
  return body as T;
}

export interface TransformResult {
  status: "ready" | "needs_input";
  explain: string;
  assumptions: Assumption[];
  questions: string[];
  candidate_project: ProjectDocument | null;
  candidate_hash: string;
  diff: ProjectDiff | null;
  diff_summary: string | null;
  warnings: unknown[];
  base_revision: number;
  base_hash: string;
  meta: { provider: string; model: string; latency_ms: number; attempts: number; few_shot_id?: string | null; few_shot_score?: number | null };
}

export interface PreviewResult {
  ok: boolean;
  candidate_hash?: string;
  diff?: ProjectDiff;
  diff_summary?: string;
  warnings?: Array<{ path: string; message: string }>;
  errors?: Array<{ path: string; message: string }>;
  base_revision?: number;
  base_hash?: string;
}

export interface RevisionListItem {
  revision: number;
  hash: string;
  saved_at: string;
  source: "init" | "ai_apply" | "manual_json" | "import" | "preset" | "undo" | "restore" | "new" | "rename";
  note: string;
  element_count: number;
  panel: { width: number; height: number } | null;
  is_current: boolean;
}

export interface PresencePeer {
  id: string;
  label: string;
  last_seen_s: number;
}

export interface PresenceResult {
  revision: number;
  hash: string;
  updated_at: string;
  peers: PresencePeer[];
}

export interface RevisionDocResult {
  revision: number;
  hash: string;
  saved_at: string;
  source: RevisionListItem["source"];
  note: string;
  element_count: number;
  panel: { width: number; height: number } | null;
  project: ProjectDocument;
}

export const api = {
  health: () => call<{ ok: boolean; revision: number }>("/api/health"),
  /** presença multi-operador: contadores leves para polling (sem o documento) */
  presence: () => call<PresenceResult>("/api/presence"),
  /** heartbeat de presença com identidade: registra o cliente e devolve peers ativos */
  presencePing: (client_id: string) =>
    call<PresenceResult>("/api/presence", { method: "POST", body: JSON.stringify({ client_id }) }),
  meta: () =>
    call<{
      active_provider: string;
      providers: Array<{ id: string; label: string; current_model: string; configured: boolean; active: boolean; supports_image: boolean }>;
    }>("/api/meta"),
  getProject: () => call<ProjectState>("/api/project"),
  newProject: (name?: string) =>
    call<ProjectState>("/api/project/new", { method: "POST", body: JSON.stringify({ name }) }),
  importProject: (project: unknown) =>
    call<ProjectState>("/api/project/import", { method: "POST", body: JSON.stringify({ project }) }),
  renameProject: (name: string, base_revision: number, base_hash: string) =>
    call<ProjectState & { message: string }>("/api/project/rename", {
      method: "POST",
      body: JSON.stringify({ name, base_revision, base_hash }),
    }),
  listPresets: () =>
    call<{
      references: Array<{ id: string; name: string; description: string }>;
      custom: Array<{ id: string; name: string; description: string }>;
    }>("/api/presets"),
  loadPreset: (id: string) => call<ProjectState & { message: string }>("/api/presets/load", { method: "POST", body: JSON.stringify({ id }) }),
  saveCustomPreset: (project: ProjectDocument, name: string, description: string) =>
    call<{ id: string; message: string }>("/api/presets/custom", {
      method: "POST",
      body: JSON.stringify({ project, name, description }),
    }),
  aiProviders: () => call<{ providers: Array<{ id: string; label: string; default_models: string[]; current_model: string; configured: boolean; active: boolean }> }>("/api/ai/providers"),
  aiConfig: () =>
    call<{
      active_provider: string;
      providers: Record<string, { model: string; timeout_ms?: number; api_key_masked: string; configured: boolean }>;
    }>("/api/ai/config"),
  saveAiConfig: (patch: { provider?: string; target?: "gemini" | "zai"; model?: string; api_key?: string; timeout_ms?: number }) =>
    call<{ message: string; active_provider: string }>("/api/ai/config", { method: "POST", body: JSON.stringify(patch) }),
  testProvider: (provider: string) =>
    call<{ ok: boolean; provider: string; model: string; latency_ms: number; detail: string; message: string }>("/api/ai/test", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
  transform: (input: { request: string; base_revision: number; base_hash: string; attachments?: Array<{ type: "image"; name: string; data_url: string }> }) =>
    call<TransformResult>("/api/ai/transform", { method: "POST", body: JSON.stringify(input) }),
  listExamples: () =>
    call<{ examples: Array<{ id: string; request: string; operator_note: string; saved_at: string; before_elements: number; after_elements: number; size_bytes: number }>; total: number }>(
      "/api/examples",
    ),
  preview: (candidate: unknown) => call<PreviewResult>("/api/preview", { method: "POST", body: JSON.stringify({ candidate }) }),
  apply: (input: { candidate: unknown; base_revision: number; base_hash: string; origin?: "ai" | "json" }) =>
    call<ProjectState & { message: string }>("/api/apply", { method: "POST", body: JSON.stringify(input) }),
  undo: () => call<ProjectState & { message: string }>("/api/undo", { method: "POST" }),
  listRevisions: () =>
    call<{ revisions: RevisionListItem[]; current: number }>("/api/project/history"),
  getRevisionDoc: (rev: number) => call<RevisionDocResult>(`/api/project/history?rev=${rev}`),
  restoreRevision: (revision: number) =>
    call<ProjectState & { message: string }>("/api/project/restore", {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  saveExample: (input: { request: string; before: unknown; after: unknown; operator_note?: string }) =>
    call<{ id: string; message: string }>("/api/examples", { method: "POST", body: JSON.stringify(input) }),
  deleteExample: (id: string) => call<{ id: string; message: string }>(`/api/examples/${encodeURIComponent(id)}`, { method: "DELETE" }),
  bom: (project?: unknown) =>
    call<{ rows: Array<{ item: string; description: string; group: string; qty: number; total_length_m: number | null; total_weight_kg: number }>; total_weight_kg: number; element_count: number }>(
      "/api/export/bom",
      { method: "POST", body: JSON.stringify({ format: "json", project }) },
    ),
  async downloadPdf(project?: unknown): Promise<void> {
    const res = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiCallError(body?.error ?? { type: "http_error", message: `HTTP ${res.status}` }, res.status);
    }
    const blob = await res.blob();
    triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition")) ?? "led-cad.pdf");
  },
  /** demo HTML standalone (3D interativo + visões) pronta para o cliente */
  async downloadStandaloneHtml(project?: unknown): Promise<void> {
    const res = await fetch("/api/export/html", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiCallError(body?.error ?? { type: "http_error", message: `HTTP ${res.status}` }, res.status);
    }
    const blob = await res.blob();
    triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition")) ?? "ledcollor-cad-demo.html");
  },
  /** relatório PDF de diferenças entre a revisão pedida e a atual */
  async downloadDiffPdf(revision: number): Promise<void> {
    const res = await fetch("/api/export/diff-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiCallError(body?.error ?? { type: "http_error", message: `HTTP ${res.status}` }, res.status);
    }
    const blob = await res.blob();
    triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition")) ?? `led-cad-diff-rev${revision}.pdf`);
  },
  async downloadBomCsv(project?: unknown): Promise<void> {
    const res = await fetch("/api/export/bom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: "csv", project }) });
    if (!res.ok) throw new ApiCallError({ type: "http_error", message: `HTTP ${res.status}` }, res.status);
    const blob = await res.blob();
    triggerDownload(blob, "bom.csv");
  },
  async downloadJson(): Promise<void> {
    const res = await fetch("/api/project/export");
    const blob = await res.blob();
    triggerDownload(blob, filenameFromDisposition(res.headers.get("content-disposition")) ?? "project.json");
  },
};

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/filename="?([^";]+)"?/);
  return m ? m[1] : null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
