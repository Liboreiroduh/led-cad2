import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ project?: unknown; name?: string; description?: string }>(req);
    if (!body?.project) return ok({ error: { type: "bad_request", message: "campo 'project' obrigatório" } }, 400);
    const store = getStore();
    const patch = body.project as { project?: { name?: string; description?: string } };
    if (body.name && patch.project) patch.project.name = body.name;
    if (body.description && patch.project) patch.project.description = body.description;
    const { id } = store.saveCustomPreset(body.project as never);
    return ok({ id, message: "preset customizado salvo" });
  } catch (e) {
    return handleError(e);
  }
}
