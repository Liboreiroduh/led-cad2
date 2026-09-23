/**
 * VALIDAÇÃO GEOMÉTRICA do GeometryDocument v2.
 * RÍGIDO NA GEOMETRIA, FLEXÍVEL NA SEMÂNTICA:
 *  - valida números, coordenadas finitas, IDs únicos, comprimentos, faces de mesh;
 *  - NUNCA valida perfil/material/role — metadata livre não bloqueia.
 * Aceita documentos v1 (legado) via normalizeProjectDoc.
 */
import {
  GeometryDocumentSchema,
  panelDimsOf,
  type GeometryDocument,
  type GeometryElement,
} from "./geometry";
import { normalizeProjectDoc } from "./legacy-adapter";
import { projectHash } from "./hashing";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  hash: string;
  /** documento normalizado v2 (presente quando ok) */
  doc?: GeometryDocument;
}

function len3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

const LIMIT = 500_000; // mm — coordenada absurda vira warning, não erro

function checkFinitePoints(el: GeometryElement, pts: Array<{ x: number; y: number; z: number }>, warnings: ValidationIssue[]): void {
  for (const p of pts) {
    if (Math.abs(p.x) > LIMIT || Math.abs(p.y) > LIMIT || Math.abs(p.z) > LIMIT) {
      warnings.push({ path: `elements.${el.id}`, message: "coordenada muito distante da origem (>500m) — verificar unidade" });
      break;
    }
  }
}

export function validateProject(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // v1 (legado) é convertido; v2 passa direto. Falha de forma → erros de schema.
  let doc: GeometryDocument;
  try {
    doc = normalizeProjectDoc(raw).doc;
  } catch (e) {
    const zodError = e as { issues?: Array<{ path: Array<string | number>; message: string }> };
    for (const issue of (zodError.issues ?? []).slice(0, 30)) {
      errors.push({
        path: issue.path.map(String).join(".") || "(raiz)",
        message: issue.message,
      });
    }
    if (errors.length === 0) {
      errors.push({ path: "(raiz)", message: (e as Error)?.message ?? "documento fora do schema" });
    }
    return { ok: false, errors, warnings, hash: "" };
  }

  // IDs únicos
  const seen = new Map<string, number>();
  for (const el of doc.elements) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) errors.push({ path: `elements.${id}`, message: `ID duplicado (${count}x)` });
  }

  for (const el of doc.elements) {
    const g = el.geometry;
    checkFinitePoints(el, collectPoints(g), warnings);

    switch (g.type) {
      case "beam":
        if (len3(g.start, g.end) < 1) errors.push({ path: `elements.${el.id}`, message: "beam com comprimento nulo" });
        break;
      case "cylinder":
        if (len3(g.start, g.end) < 1) errors.push({ path: `elements.${el.id}`, message: "cylinder com comprimento nulo" });
        break;
      case "line":
        if (len3(g.start, g.end) < 0.5) warnings.push({ path: `elements.${el.id}`, message: "line com comprimento ~zero" });
        break;
      case "mesh":
        for (let fi = 0; fi < g.faces.length; fi++) {
          for (const idx of g.faces[fi]) {
            if (idx >= g.vertices.length) {
              errors.push({ path: `elements.${el.id}`, message: `mesh face ${fi}: índice ${idx} fora dos vértices (${g.vertices.length})` });
              break;
            }
          }
        }
        break;
      case "arc":
        if (Math.abs(g.end_angle - g.start_angle) >= 360) {
          warnings.push({ path: `elements.${el.id}`, message: "arc com variação ≥360° — prefira circle" });
        }
        break;
      case "text":
        if (!g.text.trim()) warnings.push({ path: `elements.${el.id}`, message: "text vazio" });
        break;
      default:
        break;
    }
  }

  // Painel LED legado presente? (apenas warning — não é obrigatório no motor livre)
  const hasLed = doc.elements.some((e) => e.metadata?.led === true);
  const hasPanelExt = panelDimsOf(doc) !== null;
  if (!hasLed && hasPanelExt) {
    warnings.push({
      path: "elements",
      message: "extensions.panel presente sem nenhum elemento metadata.led — painel de referência não será desenhado",
    });
  }

  return { ok: errors.length === 0, errors, warnings, hash: projectHash(doc), doc };
}

function collectPoints(g: GeometryElement["geometry"]): Array<{ x: number; y: number; z: number }> {
  switch (g.type) {
    case "line":
    case "beam":
    case "cylinder":
    case "dimension":
      return [g.start, g.end];
    case "box":
      return [g.center];
    case "circle":
    case "arc":
      return [g.center];
    case "text":
      return [g.position];
    case "polyline":
    case "polygon":
    case "surface":
      return g.points;
    case "mesh":
      return g.vertices;
    default:
      return [];
  }
}

export function parseProject(raw: unknown): { ok: true; project: GeometryDocument } | { ok: false; errors: ValidationIssue[] } {
  const result = validateProject(raw);
  if (!result.ok || !result.doc) return { ok: false, errors: result.errors };
  return { ok: true, project: result.doc };
}
