import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ id?: string }>(req);
    if (!body?.id) return ok({ error: { type: "bad_request", message: "campo 'id' obrigatório" } }, 400);
    const store = getStore();
    const state = store.loadPreset(body.id);
    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      message: `preset ${body.id} carregado`,
    });
  } catch (e) {
    return handleError(e);
  }
}
