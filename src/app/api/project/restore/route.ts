import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** Restaura o documento de uma revisão antiga como NOVA revisão (com conflito 409 e snapshot p/ undo). */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ revision?: number; base_revision?: number; base_hash?: string }>(req);
    if (typeof body?.revision !== "number") {
      return ok({ error: { type: "bad_request", message: "campo 'revision' obrigatório" } }, 400);
    }
    const store = getStore();
    const state = store.restoreRevision(body.revision, store.state.revision, store.state.hash);
    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      message: `documento da revisão ${body.revision} restaurado`,
      can_undo: store.undoStack.length > 0,
    });
  } catch (e) {
    return handleError(e);
  }
}
