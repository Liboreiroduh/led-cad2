import { getStore } from "@/lib/store";
import { ok, handleError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const store = getStore();
    const state = store.undo();
    if (!state) {
      return ok({ error: { type: "nothing_to_undo", message: "Nada para desfazer." } }, 400);
    }
    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      message: "desfeito (snapshot anterior restaurado)",
      can_undo: store.undoStack.length > 0,
    });
  } catch (e) {
    return handleError(e);
  }
}
