/**
 * PROJECT DOCUMENT — fonte de verdade do CAD.
 *
 * v2: o documento é um GEOMETRY DOCUMENT (motor geométrico livre).
 * Os nomes de tipo são preservados (ProjectDocument, CadElement) para não quebrar
 * a infraestrutura existente — o formato dos elementos mudou para {id, geometry, metadata}.
 * Compatibilidade v1 → v2: ver legacy-adapter.ts.
 */
import type { Assumption, ProjectDocument } from "./geometry";

export * from "./geometry";

/** Envelope do projeto armazenado (revision + hash + doc). */
export interface StoredProject {
  revision: number;
  hash: string;
  project: ProjectDocument;
  saved_at: string;
  updated_at: string;
}

/** Resposta da IA — contrato único para Gemini / Z.ai / Mock. */
export interface AITransformResponse {
  status: "ready" | "needs_input";
  explain: string;
  assumptions: Assumption[];
  questions: string[];
  project: ProjectDocument | null;
}

/** Diff calculado pelo SISTEMA (nunca pela IA). */
export interface ProjectDiff {
  added: string[];
  removed: string[];
  modified: string[];
  counts: { added: number; removed: number; modified: number; total: number };
  /** true quando o painel legado (metadata.extensions.panel) mudou — compat UI */
  panel_changed: boolean;
  info_changed: boolean;
}
