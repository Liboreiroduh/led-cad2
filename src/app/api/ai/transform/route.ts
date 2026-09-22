import { getStore } from "@/lib/store";
import { transformProject } from "@/lib/ai/registry";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";
import { diffProjects, describeDiff } from "@/lib/cad/diff";
import type { AiAttachment, ProviderId } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{
      provider?: ProviderId;
      request?: string;
      base_revision?: number;
      base_hash?: string;
      project?: unknown;
      attachments?: AiAttachment[];
    }>(req);

    if (!body.request || !body.request.trim()) {
      return ok({ error: { type: "bad_request", message: "campo 'request' é obrigatório" } }, 400);
    }

    const store = getStore();

    // Concorrência: o JSON enviado deve ser o atual do servidor
    if (typeof body.base_revision === "number" && typeof body.base_hash === "string") {
      store.checkConflict(body.base_revision, body.base_hash);
    }

    // Projeto atual vem SEMPRE do servidor (fonte de verdade), não do cliente
    const current = store.state.project;
    const attachments = (body.attachments ?? []).filter((a) => a?.data_url?.startsWith("data:"));

    const output = await transformProject({
      providerId: body.provider,
      currentProject: current,
      userRequest: body.request.trim(),
      attachments,
    });

    const diff = output.candidate ? diffProjects(current, output.candidate) : null;

    return ok({
      status: output.response.status,
      explain: output.response.explain,
      assumptions: output.response.assumptions,
      questions: output.response.questions,
      candidate_project: output.candidate,
      candidate_hash: output.candidate_hash,
      diff,
      diff_summary: diff ? describeDiff(diff) : null,
      warnings: output.validation_warnings,
      base_revision: store.state.revision,
      base_hash: store.state.hash,
      meta: output.meta,
    });
  } catch (e) {
    return handleError(e);
  }
}
