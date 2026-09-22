import { listProviders } from "@/lib/ai/registry";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({ providers: listProviders() });
}
