/** Fábrica de projeto em branco + helpers de ID. */
import type { ProjectDocument } from "./schema";
import { newProjectId } from "./hashing";

export function blankProject(name = "Novo Painel LED"): ProjectDocument {
  return {
    schema_version: 1,
    units: "mm",
    project: {
      id: newProjectId(),
      name,
      description: "Projeto em branco — descreva a estrutura desejada no Copiloto IA.",
    },
    panel: {
      width: 1920,
      height: 960,
      depth: 650,
      ground_clearance: 3000,
    },
    installation: {
      type: "post",
      environment: "outdoor",
    },
    elements: [
      {
        id: "PANEL-LED",
        type: "panel",
        role: "panel",
        profile: "",
        group: "PAINEL",
        center: { x: 0, y: 0, z: 3000 + 960 / 2 },
        size_x: 1920,
        size_y: 120,
        size_z: 960,
        label: "PAINEL LED 1920x960",
      },
    ],
    assumptions: [],
    metadata: {
      source: "manual",
      preset_id: null,
      reviews: [],
    },
  };
}

/** Próximo id disponível com prefixo, ex.: nextId(doc, "POST") → POST-03 */
export function nextId(doc: ProjectDocument, prefix: string): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const el of doc.elements) {
    const m = el.id.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

export function elementSummary(doc: ProjectDocument): string {
  const byType = new Map<string, number>();
  for (const el of doc.elements) byType.set(el.type, (byType.get(el.type) ?? 0) + 1);
  return [...byType.entries()].map(([t, n]) => `${n} ${t}`).join(", ");
}
