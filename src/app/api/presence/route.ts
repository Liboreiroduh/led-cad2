import { getStore } from "@/lib/store";
import { ok } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/**
 * PRESENÇA — endpoint leve para polling multi-operador.
 * Retorna apenas contadores (rev + hash + updated_at), SEM o documento —
 * resposta de poucos bytes para permitir polling frequente sem custo.
 * Clientes comparam com seu estado local para detectar "outro operador ativo".
 */
export async function GET() {
  const store = getStore();
  return ok({
    revision: store.state.revision,
    hash: store.state.hash,
    updated_at: store.state.updated_at,
  });
}
