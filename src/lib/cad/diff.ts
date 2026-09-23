/**
 * DIFF AUTOMÁTICO — calculado pelo sistema, NUNCA pela IA.
 * Compara elementos por id estável + mudanças de extensions.panel/info.
 */
import type { ProjectDiff, ProjectDocument } from "./schema";
import { panelDimsOf } from "./geometry";
import { canonicalJson } from "./hashing";

export function diffProjects(oldDoc: ProjectDocument, newDoc: ProjectDocument): ProjectDiff {
  const oldEls = new Map(oldDoc.elements.map((e) => [e.id, e]));
  const newEls = new Map(newDoc.elements.map((e) => [e.id, e]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [id, el] of newEls) {
    if (!oldEls.has(id)) {
      added.push(id);
    } else if (canonicalJson(oldEls.get(id)) !== canonicalJson(el)) {
      modified.push(id);
    }
  }
  for (const id of oldEls.keys()) {
    if (!newEls.has(id)) removed.push(id);
  }

  added.sort();
  removed.sort();
  modified.sort();

  const oldPanel = panelDimsOf(oldDoc);
  const newPanel = panelDimsOf(newDoc);

  return {
    added,
    removed,
    modified,
    counts: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      total: added.length + removed.length + modified.length,
    },
    panel_changed: canonicalJson(oldPanel) !== canonicalJson(newPanel),
    info_changed: canonicalJson(oldDoc.project) !== canonicalJson(newDoc.project),
  };
}

export function describeDiff(diff: ProjectDiff): string {
  const parts: string[] = [];
  if (diff.counts.added) parts.push(`${diff.counts.added} novas`);
  if (diff.counts.modified) parts.push(`${diff.counts.modified} editadas`);
  if (diff.counts.removed) parts.push(`${diff.counts.removed} removidas`);
  const base = parts.length ? parts.join(" · ") : "nenhuma alteração de elementos";
  return `${diff.counts.total} alterações propostas — ${base}${diff.panel_changed ? " · painel alterado" : ""}`;
}
