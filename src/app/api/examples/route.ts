import { getStore } from "@/lib/store";
import { ok, handleError, readJsonBody } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** §25 — Salvar como exemplo (futuros few-shots). Sem fine-tuning automático. */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{
      request?: string;
      before?: unknown;
      after?: unknown;
      operator_note?: string;
    }>(req);
    if (!body?.request) return ok({ error: { type: "bad_request", message: "campo 'request' obrigatório" } }, 400);
    const id = getStore().saveExample({
      request: body.request,
      before: body.before ?? null,
      after: body.after ?? null,
      operator_note: body.operator_note ?? "",
    });
    return ok({ id, message: "exemplo salvo em data/examples" });
  } catch (e) {
    return handleError(e);
  }
}
