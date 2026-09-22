import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ project?: unknown; note?: string }>(req);
    if (!body?.project) {
      return ok({ error: { type: "invalid_document", message: "campo 'project' obrigatório" } }, 400);
    }
    const state = getStore().applyValidatedRaw(body.project, "import");
    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      note: body.note ?? "importado",
    });
  } catch (e) {
    return handleError(e);
  }
}
