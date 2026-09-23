import { getStore } from "@/lib/store";
import { listProviders } from "@/lib/ai/registry";
import { PROFILES } from "@/lib/cad/profiles";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const cfg = store.getAiConfig();
  return ok({
    app: "LED JSON CAD",
    vendor: "LED Collor",
    schema_version: 2,
    units: "mm",
    /** catálogo de perfis permanece apenas como REFERÊNCIA opcional (BOM/metadata) */
    profiles: PROFILES.map((p) => p.name),
    active_provider: cfg.active_provider,
    providers: listProviders(),
    revision: store.state.revision,
    hash: store.state.hash,
  });
}
