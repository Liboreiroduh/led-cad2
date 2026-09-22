/**
 * Hash canônico (SHA-256) do ProjectDocument.
 * JSON canônico: chaves ordenadas, números arredondados a 3 casas.
 */
import { createHash } from "crypto";
import type { ProjectDocument } from "./schema";

function roundNumbers(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
  }
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = roundNumbers((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function canonicalJson(doc: unknown): string {
  return JSON.stringify(roundNumbers(doc));
}

export function projectHash(doc: ProjectDocument): string {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

export function newProjectId(): string {
  return `LED-${createHash("sha1")
    .update(canonicalJson({ t: Date.now(), r: Math.random() }))
    .digest("hex")
    .slice(0, 10)
    .toUpperCase()}`;
}
