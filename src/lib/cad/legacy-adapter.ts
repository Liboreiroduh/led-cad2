/**
 * LEGACY ADAPTER — LegacyElement → GeometryElement (FASE 1 da migração).
 * Fluxo: JSON antigo (schema v1) → adapter → GeometryDocument v2 → renderer.
 * O JSON antigo NUNCA é rejeitado: é convertido. Painel/installation do legado
 * vão para metadata.extensions (preservados para PDF/histórico).
 */
import { getProfile } from "./profiles";
import {
  GeometryDocumentSchema,
  type GeometryDocument,
  type GeometryElement,
} from "./geometry";

/* ---------------------- shape mínimo do legado v1 ---------------------- */

interface Vec3L {
  x: number;
  y: number;
  z: number;
}
interface LegacyElement {
  id: string;
  type: string;
  role?: string;
  profile?: string;
  group?: string;
  label?: string;
  start?: Vec3L;
  end?: Vec3L;
  center?: Vec3L;
  size_x?: number;
  size_y?: number;
  size_z?: number;
  diameter?: number;
  length?: number;
  points?: Vec3L[];
  thickness?: number;
}
interface LegacyDoc {
  schema_version?: number;
  units?: string;
  project?: { id: string; name: string; description?: string };
  panel?: { width: number; height: number; depth: number; ground_clearance: number };
  installation?: { type: string; environment: string };
  elements?: LegacyElement[];
  assumptions?: unknown[];
  metadata?: Record<string, unknown>;
}

/** Detecta documentos legados: elementos com `type` na raiz (não `geometry`). */
export function isLegacyProject(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const doc = raw as { schema_version?: unknown; elements?: unknown };
  if (doc.schema_version === 2) return false;
  if (!Array.isArray(doc.elements)) return true; // sem elements → deixa o schema falhar
  const first = doc.elements.find((e) => e && typeof e === "object");
  if (!first) return false;
  return !("geometry" in (first as Record<string, unknown>));
}

/* --------------------------- elemento → geometry --------------------------- */

function vec(v?: Vec3L): { x: number; y: number; z: number } {
  return { x: v?.x ?? 0, y: v?.y ?? 0, z: v?.z ?? 0 };
}

function baseMetadata(el: LegacyElement, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: el.label || el.id,
    label: el.label ?? "",
    group: el.group || "GERAL",
  };
  if (el.role) out.role = el.role;
  if (el.profile) out.profile = el.profile;
  out.legacy_type = el.type;
  return { ...out, ...extra };
}

export function legacyElementToGeometry(el: LegacyElement): GeometryElement | null {
  if (!el || typeof el.id !== "string" || !el.type) return null;
  const meta = baseMetadata(el);

  switch (el.type) {
    case "beam": {
      const prof = el.profile ? getProfile(el.profile) : undefined;
      const section = prof
        ? prof.kind === "round"
          ? { type: "round" as const, width: prof.w, height: prof.h, diameter: prof.w }
          : { type: "square" as const, width: prof.w, height: prof.h, diameter: 0 }
        : { type: "square" as const, width: 60, height: 60, diameter: 0 };
      return {
        id: el.id,
        geometry: { type: "beam", start: vec(el.start), end: vec(el.end), section },
        metadata: meta,
      };
    }
    case "plate":
      return {
        id: el.id,
        geometry: {
          type: "box",
          center: vec(el.center),
          size: [el.size_x ?? 100, el.size_y ?? 100, el.size_z ?? 10],
        },
        metadata: meta,
      };
    case "panel":
      return {
        id: el.id,
        geometry: {
          type: "box",
          center: vec(el.center),
          size: [el.size_x ?? 1000, el.size_y ?? 120, el.size_z ?? 500],
        },
        metadata: { ...meta, role: el.role || "panel", led: true },
      };
    case "bolt": {
      const c = vec(el.center);
      const half = (el.length ?? 50) / 2;
      return {
        id: el.id,
        geometry: {
          type: "cylinder",
          start: { x: c.x, y: c.y, z: c.z - half },
          end: { x: c.x, y: c.y, z: c.z + half },
          diameter: el.diameter ?? 16,
        },
        metadata: meta,
      };
    }
    case "cable":
      return {
        id: el.id,
        geometry: {
          type: "line",
          start: vec(el.start),
          end: vec(el.end),
          thickness: Math.max(el.diameter ?? 8, 4),
        },
        metadata: { ...meta, role: el.role || "cable", diameter: el.diameter ?? 8 },
      };
    case "surface":
      return {
        id: el.id,
        geometry: {
          type: "polygon",
          points: (el.points ?? []).map(vec),
        },
        metadata: { ...meta, thickness: el.thickness ?? 5 },
      };
    default:
      // tipo desconhecido do legado: preserva como mesh vazio inválido? Não — rejeita só o elemento.
      return null;
  }
}

/* --------------------------- documento → v2 --------------------------- */

export function legacyProjectToGeometry(raw: unknown): GeometryDocument {
  const doc = (raw ?? {}) as LegacyDoc;
  const elements: GeometryElement[] = [];
  for (const el of doc.elements ?? []) {
    const converted = legacyElementToGeometry(el);
    if (converted) elements.push(converted);
  }

  const legacyMeta = (doc.metadata ?? {}) as Record<string, unknown>;
  const metadata: Record<string, unknown> = {
    source: typeof legacyMeta.source === "string" ? legacyMeta.source : "manual",
  };
  if (legacyMeta.preset_id !== undefined) metadata.preset_id = legacyMeta.preset_id;
  if (legacyMeta.created_at !== undefined) metadata.created_at = legacyMeta.created_at;
  if (Array.isArray(legacyMeta.reviews)) metadata.reviews = legacyMeta.reviews;

  // panel/installation do legado → metadata.extensions (não são mais obrigatórios)
  if (doc.panel || doc.installation) {
    metadata.extensions = {
      ...(doc.panel ? { panel: doc.panel } : {}),
      ...(doc.installation ? { installation: doc.installation } : {}),
    };
  }

  return GeometryDocumentSchema.parse({
    schema_version: 2,
    units: doc.units === "mm" || !doc.units ? "mm" : "mm",
    project: {
      id: doc.project?.id ?? "IMPORTADO-01",
      name: doc.project?.name ?? "Projeto importado",
      description: doc.project?.description ?? "",
    },
    elements,
    assumptions: doc.assumptions ?? [],
    metadata,
  });
}

/** Normaliza qualquer entrada (v1 ou v2) para GeometryDocument v2. */
export function normalizeProjectDoc(raw: unknown): { doc: GeometryDocument; converted: boolean } {
  if (isLegacyProject(raw)) {
    return { doc: legacyProjectToGeometry(raw), converted: true };
  }
  return { doc: GeometryDocumentSchema.parse(raw), converted: false };
}
