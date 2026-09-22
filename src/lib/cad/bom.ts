/**
 * BOM — derivado exclusivamente da geometria do ProjectDocument.
 * Sem preço no MVP.
 */
import type { ProjectDocument } from "./schema";
import { getProfile, cableKgPerMeter, STEEL_DENSITY_KG_M3 } from "./profiles";

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
}

function m3FromPlate(sx: number, sy: number, sz: number): number {
  return (sx * sy * sz) / 1e9; // mm³ → m³
}

export function deriveBom(doc: ProjectDocument): Bom {
  const rows: BomRow[] = [];
  let totalWeight = 0;

  // Beams agrupados por perfil
  const beams = doc.elements.filter((e) => e.type === "beam");
  const byProfile = new Map<string, { qty: number; total_mm: number }>();
  for (const b of beams) {
    if (b.type !== "beam") continue;
    const len = Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y, b.end.z - b.start.z);
    const entry = byProfile.get(b.profile) ?? { qty: 0, total_mm: 0 };
    entry.qty += 1;
    entry.total_mm += len;
    byProfile.set(b.profile, entry);
  }
  let idx = 1;
  for (const [profile, { qty, total_mm }] of [...byProfile.entries()].sort()) {
    const prof = getProfile(profile);
    const weight = prof ? prof.kgm * (total_mm / 1000) : 0;
    rows.push({
      item: String(idx++).padStart(2, "0"),
      description: `PERFIL ${profile}`,
      group: "ESTRUTURA",
      qty,
      unit_length_mm: null,
      total_length_m: +(total_mm / 1000).toFixed(2),
      total_weight_kg: +weight.toFixed(1),
    });
    totalWeight += weight;
  }

  // Cables por diâmetro
  const cables = new Map<number, { qty: number; total_mm: number }>();
  for (const c of doc.elements) {
    if (c.type !== "cable") continue;
    const len = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y, c.end.z - c.start.z);
    const entry = cables.get(c.diameter) ?? { qty: 0, total_mm: 0 };
    entry.qty += 1;
    entry.total_mm += len;
    cables.set(c.diameter, entry);
  }
  for (const [d, { qty, total_mm }] of [...cables.entries()].sort((a, b) => a[0] - b[0])) {
    const weight = cableKgPerMeter(d) * (total_mm / 1000);
    rows.push({
      item: String(idx++).padStart(2, "0"),
      description: `CABO DE AÇO Ø${d}mm`,
      group: "FIXAÇÃO",
      qty,
      unit_length_mm: null,
      total_length_m: +(total_mm / 1000).toFixed(2),
      total_weight_kg: +weight.toFixed(1),
    });
    totalWeight += weight;
  }

  // Plates
  const plates = doc.elements.filter((e) => e.type === "plate");
  const platesBySize = new Map<string, { qty: number; weight: number }>();
  for (const p of plates) {
    if (p.type !== "plate") continue;
    const key = `${p.size_x}x${p.size_y}x${p.size_z}`;
    const w = m3FromPlate(p.size_x, p.size_y, p.size_z) * STEEL_DENSITY_KG_M3;
    const entry = platesBySize.get(key) ?? { qty: 0, weight: 0 };
    entry.qty += 1;
    entry.weight += w;
    platesBySize.set(key, entry);
  }
  for (const [size, { qty, weight }] of [...platesBySize.entries()].sort()) {
    rows.push({
      item: String(idx++).padStart(2, "0"),
      description: `CHAPA ${size}mm`,
      group: "BASES",
      qty,
      unit_length_mm: null,
      total_length_m: null,
      total_weight_kg: +weight.toFixed(1),
    });
    totalWeight += weight;
  }

  // Bolts
  const bolts = new Map<string, { qty: number }>();
  for (const b of doc.elements) {
    if (b.type !== "bolt") continue;
    const key = `M${b.diameter}x${b.length}`;
    const entry = bolts.get(key) ?? { qty: 0 };
    entry.qty += 1;
    bolts.set(key, entry);
  }
  for (const [desc, { qty }] of [...bolts.entries()].sort()) {
    rows.push({
      item: String(idx++).padStart(2, "0"),
      description: `PARAFUSO ${desc}`,
      group: "FIXAÇÃO",
      qty,
      unit_length_mm: null,
      total_length_m: null,
      total_weight_kg: 0,
    });
  }

  return {
    rows,
    total_weight_kg: +totalWeight.toFixed(1),
    element_count: doc.elements.length,
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
