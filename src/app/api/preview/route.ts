import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";
import { validateProject } from "@/lib/cad/validation";
import { diffProjects, describeDiff } from "@/lib/cad/diff";

export const dynamic = "force-dynamic";

/** Valida um documento candidato e calcula o diff contra o atual. */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ candidate?: unknown }>(req);
    if (!body?.candidate) return ok({ error: { type: "bad_request", message: "campo 'candidate' obrigatório" } }, 400);

    const check = validateProject(body.candidate);
    if (!check.ok) {
      return ok({ ok: false, errors: check.errors, warnings: check.warnings }, 200);
    }
    const store = getStore();
    const candidate = check.hash ? (body.candidate as never) : null;
    const diff = diffProjects(store.state.project, candidate as never);
    const candidate_hash = store.putPendingPreview(candidate as never, store.state.revision, store.state.hash);
    return ok({
      ok: true,
      candidate_hash: check.hash,
      stored_hash: candidate_hash,
      diff,
      diff_summary: describeDiff(diff),
      warnings: check.warnings,
      base_revision: store.state.revision,
      base_hash: store.state.hash,
    });
  } catch (e) {
    return handleError(e);
  }
}
