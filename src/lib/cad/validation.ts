/**
 * VALIDAÇÃO GEOMÉTRICA/SEMÂNTICA do ProjectDocument.
 * Executa sempre no backend antes de qualquer preview/apply.
 */
import { ProjectDocumentSchema, type ProjectDocument } from "./schema";
import { getProfile } from "./profiles";
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
}

function len3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function validateProject(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const parsed = ProjectDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 30)) {
      errors.push({
        path: issue.path.map(String).join(".") || "(raiz)",
        message: issue.message,
      });
    }
    return { ok: false, errors, warnings, hash: "" };
  }

  const doc: ProjectDocument = parsed.data;

  // IDs únicos
  const seen = new Map<string, number>();
  for (const el of doc.elements) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) errors.push({ path: `elements.${id}`, message: `ID duplicado (${count}x)` });
  }

  // Coordenadas finitas + regras por tipo
  const { panel } = doc;
  for (const el of doc.elements) {
    const p = (el as { id: string }).id;
    if (el.type === "beam") {
      if (len3(el.start, el.end) < 1) {
        errors.push({ path: `elements.${el.id}`, message: "beam com comprimento nulo" });
      }
      const prof = getProfile(el.profile);
      if (!prof) {
        errors.push({
          path: `elements.${el.id}.profile`,
          message: `perfil desconhecido: "${el.profile}" (use o catálogo)`,
        });
      }
      if (el.end.z < el.start.z - 1 && el.role === "post") {
        warnings.push({
          path: `elements.${el.id}`,
          message: "poste com topo abaixo da base (verificar orientação)",
        });
      }
    }
    if (el.type === "cable") {
      if (len3(el.start, el.end) < 10) {
        errors.push({ path: `elements.${el.id}`, message: "cable muito curto (<10mm)" });
      }
    }
    if (el.type === "panel") {
      const wDiff = Math.abs(el.center.x - panel.width / 2);
      if (wDiff > 1 && Math.abs(el.center.x) > 1) {
        warnings.push({
          path: `elements.${el.id}`,
          message: "painel LED desalinhado com panel.width (verificar)",
        });
      }
    }
    if (el.type === "bolt" && el.length > 2000) {
      warnings.push({ path: `elements.${el.id}`, message: "parafuso com comprimento incomum" });
    }
  }

  // Elemento painel de referência presente?
  const hasPanelEl = doc.elements.some((e) => e.type === "panel");
  if (!hasPanelEl) {
    warnings.push({
      path: "elements",
      message: "nenhum elemento type=panel — painel LED não será desenhado",
    });
  }

  // Coerência: postes devem alcançar o solo
  const posts = doc.elements.filter((e) => e.type === "beam" && e.role === "post");
  for (const post of posts) {
    if (post.type === "beam" && Math.min(post.start.z, post.end.z) > 1) {
      warnings.push({
        path: `elements.${post.id}`,
        message: "poste não alcança o solo (Z=0)",
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings, hash: projectHash(doc) };
}

export function parseProject(raw: unknown): { ok: true; project: ProjectDocument } | { ok: false; errors: ValidationIssue[] } {
  const result = validateProject(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, project: ProjectDocumentSchema.parse(raw) };
}
