/**
 * BOM v2 — OPCIONAL, derivado da GEOMETRIA (nunca do material).
 * Volume por primitivo × densidade (metadata.density_kg_m3; default aço 7850 kg/m³).
 * Elementos sem massa calculável (circle, arc, text, dimension, mesh…) aparecem
 * como linhas sem peso. O CAD nunca exige BOM para aceitar geometria.
 */
import type { ProjectDocument, GeometryElement } from "./schema";
import { STEEL_DENSITY_KG_M3 } from "./profiles";

export interface BomRow {
  item: string;
  description: string;
  group: string;
  qty: number;
  unit_length_mm: number | null;
  total_length_m: number | null;
  total_weight_kg: number;
}

export interface Bom {
  rows: BomRow[];
  total_weight_kg: number;
  element_count: number;
  /** true quando pelo menos um elemento ficou sem massa calculável */
  partial: boolean;
}

function densityOf(el: GeometryElement): number {
  const d = el.metadata?.["density_kg_m3"];
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : STEEL_DENSITY_KG_M3;
}

function lengthOf(el: GeometryElement): number | null {
  const g = el.geometry;
  const dist = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  switch (g.type) {
    case "beam":
    case "cylinder":
    case "line":
    case "dimension":
      return dist(g.start, g.end);
    case "polyline": {
      let total = 0;
      for (let i = 1; i < g.points.length; i++) total += dist(g.points[i - 1], g.points[i]);
      if (g.closed && g.points.length > 2) total += dist(g.points[g.points.length - 1], g.points[0]);
      return total;
    }
    case "circle":
      return 2 * Math.PI * g.radius;
    case "arc":
      return (2 * Math.PI * g.radius * Math.abs(g.end_angle - g.start_angle)) / 360;
    default:
      return null;
  }
}

/** Volume em mm³ (null quando não calculável). */
function volumeOf(el: GeometryElement): number | null {
  const g = el.geometry;
  switch (g.type) {
    case "beam": {
      const len = lengthOf(el) ?? 0;
      const area =
        g.section.type === "round"
          ? Math.PI * (g.section.diameter / 2) ** 2
          : g.section.width * g.section.height;
      return area * len;
    }
    case "cylinder":
      return Math.PI * (g.diameter / 2) ** 2 * (lengthOf(el) ?? 0);
    case "box":
      return g.size[0] * g.size[1] * g.size[2];
    case "line":
    case "polyline": {
      const t = (g as { thickness?: number }).thickness ?? 8;
      return (lengthOf(el) ?? 0) * t * t;
    }
    case "surface": {
      const t = g.thickness ?? 5;
      // área por fan (aprox. para superfícies quase planas)
      const [p0, ...rest] = g.points;
      let area = 0;
      for (let i = 0; i < rest.length - 1; i++) {
        const a = { x: rest[i].x - p0.x, y: rest[i].y - p0.y, z: rest[i].z - p0.z };
        const b = { x: rest[i + 1].x - p0.x, y: rest[i + 1].y - p0.y, z: rest[i + 1].z - p0.z };
        const cx = a.y * b.z - a.z * b.y;
        const cy = a.z * b.x - a.x * b.z;
        const cz = a.x * b.y - a.y * b.x;
        area += Math.hypot(cx, cy, cz) / 2;
      }
      return area * t;
    }
    default:
      return null; // circle/arc/polygon/mesh/text/dimension → massa não calculável
  }
}

function descOf(el: GeometryElement): string {
  const g = el.geometry;
  const name = typeof el.metadata?.name === "string" ? el.metadata.name : "";
  const profile = typeof el.metadata?.profile === "string" ? el.metadata.profile : "";
  const material = typeof el.metadata?.material === "string" ? el.metadata.material : "";
  const label = profile || material || name || g.type;
  const sizePart =
    g.type === "beam"
      ? g.section.type === "round"
        ? `Ø${g.section.diameter}`
        : `${g.section.width}x${g.section.height}`
      : g.type === "cylinder"
        ? `Ø${g.diameter}`
        : g.type === "box"
          ? `${g.size[0]}x${g.size[1]}x${g.size[2]}`
          : "";
  return `${g.type.toUpperCase()} ${sizePart} · ${label}`.trim();
}

function groupOfBom(el: GeometryElement): string {
  const g = (typeof el.metadata?.group === "string" ? el.metadata.group : "").toUpperCase();
  return g || "GERAL";
}

export function deriveBom(doc: ProjectDocument): Bom {
  const rows: BomRow[] = [];
  let totalWeight = 0;
  let partial = false;

  // agrupa por (descrição + densidade) — elementos iguais somam
  interface BomGroup {
    qty: number;
    total_mm: number;
    weight: number;
    desc: string;
    group: string;
    hasWeight: boolean;
  }
  const groups = new Map<string, BomGroup>();
  for (const el of doc.elements) {
    const desc = descOf(el);
    const density = densityOf(el);
    const vol = volumeOf(el); // mm³
    const len = lengthOf(el);
    const hasWeight = vol !== null;
    if (!hasWeight) partial = true;
    const weight = vol !== null ? (vol / 1e9) * density : 0;
    const key = `${desc}||${density}`;
    const entry = groups.get(key) ?? {
      qty: 0,
      total_mm: 0,
      weight: 0,
      desc,
      group: groupOfBom(el),
      hasWeight,
    };
    entry.qty += 1;
    entry.total_mm += len ?? 0;
    entry.weight += weight;
    groups.set(key, entry);
  }

  let idx = 1;
  for (const [, e] of [...groups.entries()].sort((a, b) => a[1].desc.localeCompare(b[1].desc))) {
    rows.push({
      item: String(idx++).padStart(2, "0"),
      description: e.hasWeight ? e.desc : `${e.desc} (sem massa calculável)`,
      group: e.group,
      qty: e.qty,
      unit_length_mm: null,
      total_length_m: e.total_mm > 0 ? +(e.total_mm / 1000).toFixed(2) : null,
      total_weight_kg: e.hasWeight ? +e.weight.toFixed(1) : 0,
    });
    totalWeight += e.weight;
  }

  return {
    rows,
    total_weight_kg: +totalWeight.toFixed(1),
    element_count: doc.elements.length,
    partial,
  };
}

export function bomToCsv(bom: Bom): string {
  const header = "Item;Descricao;Grupo;Qtd;Comprimento total (m);Peso estimado (kg)";
  const lines = bom.rows.map((r) =>
    [r.item, r.description, r.group, r.qty, r.total_length_m ?? "", r.total_weight_kg].join(";"),
  );
  lines.push(`;;;;TOTAL;${bom.total_weight_kg}`);
  return [header, ...lines].join("\n");
}

/**
 * Peso individual estimado de um elemento (kg) — mesma matemática do BOM.
 * Retorna null quando o primitivo não tem massa calculável.
 * Função pura, segura para import no cliente.
 */
export function estimateElementWeightKg(el: GeometryElement): number | null {
  const vol = volumeOf(el);
  if (vol === null) return null;
  return +((vol / 1e9) * densityOf(el)).toFixed(2);
}
