import { getStore } from "@/lib/store";
import { ok, handleError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/**
 * Histórico de revisões do projeto.
 *  GET /api/project/history            → lista (sem documentos)
 *  GET /api/project/history?rev=N      → documento completo da revisão N
 */
export async function GET(req: Request) {
  try {
    const store = getStore();
    const url = new URL(req.url);
    const revParam = url.searchParams.get("rev");
    if (revParam !== null) {
      const rev = Number.parseInt(revParam, 10);
      if (!Number.isFinite(rev)) {
        return ok({ error: { type: "bad_request", message: "rev inválida" } }, 400);
      }
      const entry = store.getRevision(rev);
      if (!entry) {
        return ok({ error: { type: "not_found", message: `revisão ${rev} não encontrada` } }, 404);
      }
      return ok({
        revision: entry.revision,
        hash: entry.hash,
        saved_at: entry.saved_at,
        source: entry.source,
        note: entry.note,
        element_count: entry.element_count,
        panel: entry.panel,
        project: entry.project,
      });
    }
    return ok({ revisions: store.listRevisions(), current: store.state.revision });
  } catch (e) {
    return handleError(e);
  }
}
