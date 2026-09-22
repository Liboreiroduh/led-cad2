import { getStore, ConflictError } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";
import { parseProject } from "@/lib/cad/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{
      candidate?: unknown;
      base_revision?: number;
      base_hash?: string;
    }>(req);
    if (!body?.candidate) return ok({ error: { type: "bad_request", message: "campo 'candidate' obrigatório" } }, 400);

    const parsed = parseProject(body.candidate);
    if (!parsed.ok) {
      return ok({ error: { type: "invalid_candidate", message: "candidato inválido", details: parsed.errors } }, 400);
    }

    const store = getStore();
    // confirma que base_revision ainda é a atual (§20)
    if (
      typeof body.base_revision === "number" &&
      typeof body.base_hash === "string" &&
      (store.state.revision !== body.base_revision || store.state.hash !== body.base_hash)
    ) {
      throw new ConflictError();
    }

    const state = store.applyCandidate(parsed.project, store.state.revision, store.state.hash);
    return ok({
      revision: state.revision,
      hash: state.hash,
      project: state.project,
      message: "candidato aplicado",
      can_undo: store.undoStack.length > 0,
    });
  } catch (e) {
    return handleError(e);
  }
}
