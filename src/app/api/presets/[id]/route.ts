import { getStore } from "@/lib/store";
import { ok, fail } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = getStore();
  const doc = store.getPresetDoc(decodeURIComponent(id));
  if (!doc) return fail(404, "not_found", `preset não encontrado: ${id}`);
  return ok({ id, project: doc });
}
