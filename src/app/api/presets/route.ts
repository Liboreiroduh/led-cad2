import { getStore } from "@/lib/store";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return ok(store.listPresets());
}
