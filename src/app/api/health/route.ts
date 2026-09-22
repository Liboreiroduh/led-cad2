import { getStore } from "@/lib/store";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return ok({
    ok: true,
    service: "led-json-cad",
    revision: store.state.revision,
    time: new Date().toISOString(),
  });
}
