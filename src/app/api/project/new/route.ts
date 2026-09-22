import { getStore } from "@/lib/store";
import { blankProject } from "@/lib/cad/blank";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ name?: string }>(req).catch(() => ({ name: undefined }));
    const doc = blankProject(body?.name || "Novo Painel LED");
    const state = getStore().applyValidatedRaw(doc, "manual");
    return ok({ revision: state.revision, hash: state.hash, project: state.project });
  } catch (e) {
    return handleError(e);
  }
}
