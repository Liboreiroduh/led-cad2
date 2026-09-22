import { getStore } from "@/lib/store";
import { ok, handleError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** §25 — Remove um exemplo few-shot salvo pelo operador. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const removed = getStore().deleteExample(id);
    if (!removed) {
      return ok({ error: { type: "not_found", message: `exemplo ${id} não encontrado` } }, 404);
    }
    return ok({ id, message: "exemplo removido" });
  } catch (e) {
    return handleError(e);
  }
}
