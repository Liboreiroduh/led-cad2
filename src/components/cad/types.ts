"use client";

/** Tipos compartilhados da UI do CAD. */
import type { Assumption, ProjectDocument } from "@/lib/cad/schema";

export interface HistoryItem {
  id: string;
  role: "user" | "assistant" | "error" | "info";
  text: string;
  ts: string;
  meta?: {
    status?: "ready" | "needs_input";
    explain?: string;
    assumptions?: Assumption[];
    questions?: string[];
    diffSummary?: string | null;
    provider?: string;
    model?: string;
    latency?: number;
    fewShot?: string | null;
    /** similaridade de Jaccard pedido↔exemplo (0–1) reportada pelo registry */
    fewShotScore?: number | null;
    applied?: boolean;
    candidate?: ProjectDocument | null;
    baseRevision?: number;
    baseHash?: string;
    errorType?: string;
  };
}
