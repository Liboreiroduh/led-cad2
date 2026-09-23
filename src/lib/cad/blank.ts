/** Fábrica de projeto em branco (v2 geométrico) + helpers de ID. */
import type { ProjectDocument, GeometryElement } from "./schema";
import { newProjectId } from "./hashing";

export function blankProject(name = "Novo Painel LED"): ProjectDocument {
  return {
    schema_version: 2,
    units: "mm",
    project: {
      id: newProjectId(),
      name,
      description: "Projeto em branco — descreva a estrutura desejada no Copiloto IA.",
    },
    elements: [
      {
        id: "PANEL-LED",
        geometry: {
          type: "box",
          center: { x: 0, y: 0, z: 3000 + 960 / 2 },
          size: [1920, 120, 960],
        },
        metadata: {
          name: "PAINEL LED 1920x960",
          label: "PAINEL LED 1920x960",
          group: "PAINEL",
          role: "panel",
          led: true,
        },
      },
    ],
    assumptions: [],
    metadata: { source: "manual" },
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

/** Helper para criar elemento geométrico com metadata mínima. */
export function mkElement(
  id: string,
  geometry: GeometryElement["geometry"],
  metadata: GeometryElement["metadata"] = {},
): GeometryElement {
  return { id, geometry, metadata };
}

export function elementSummary(doc: ProjectDocument): string {
  const byType = new Map<string, number>();
  for (const el of doc.elements) byType.set(el.geometry.type, (byType.get(el.geometry.type) ?? 0) + 1);
  return [...byType.entries()].map(([t, n]) => `${n} ${t}`).join(", ");
}
