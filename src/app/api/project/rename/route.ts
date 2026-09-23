import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** POST /api/project/rename — renomeia o projeto como revisão própria (undo-able). */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{
      name?: string;
      base_revision?: number;
      base_hash?: string;
    }>(req);

    if (!body.name || !body.name.trim()) {
      return ok({ error: { type: "bad_request", message: "campo 'name' é obrigatório" } }, 400);
    }

    const store = getStore();
    const baseRev = typeof body.base_revision === "number" ? body.base_revision : store.state.revision;
    const baseHash = typeof body.base_hash === "string" ? body.base_hash : store.state.hash;
    const state = store.renameProject(body.name, baseRev, baseHash);

    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      can_undo: store.undoStack.length > 0,
      message: "projeto renomeado",
    });
  } catch (e) {
    return handleError(e);
  }
}
