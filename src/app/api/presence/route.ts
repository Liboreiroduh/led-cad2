import { getStore } from "@/lib/store";
import { ok, fail } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/**
 * PRESENÇA v2 — heartbeat multi-operador com identidade de sessão.
 *
 *  GET  → contadores leves (revision/hash/updated_at) + peers ativos (leitura).
 *  POST → registra/atualiza o heartbeat de um cliente { client_id, label? } e
 *         devolve o mesmo payload — o cliente faz POST a cada ciclo de polling,
 *         então uma chamada só já faz "estou vivo" + "o que mudou".
 *
 * Peers são TRANSIENTES (só memória, globalThis p/ sobreviver ao HMR) —
 * nada de PII: id aleatório gerado no cliente + rótulo curto opcional.
 * TTL de 30s: quem para de fazer heartbeat sai da lista sozinho.
 */
const PEER_TTL_MS = 30_000;
const PEER_MAX = 50;

interface PeerEntry {
  last_seen: number;
  label: string;
}

// globalThis: o dev do Next recompila o módulo por rota — o mapa precisa
// sobreviver ao HMR para não "esquecer" operadores a cada recompile.
const g = globalThis as unknown as { __ledCadPeers?: Map<string, PeerEntry> };

function peersMap(): Map<string, PeerEntry> {
  if (!g.__ledCadPeers) g.__ledCadPeers = new Map();
  return g.__ledCadPeers;
}

function prunePeers(now: number): void {
  const m = peersMap();
  for (const [k, v] of m) {
    if (now - v.last_seen > PEER_TTL_MS) m.delete(k);
  }
}

function snapshotPeers(now: number): Array<{ id: string; label: string; last_seen_s: number }> {
  prunePeers(now);
  return [...peersMap().entries()]
    .sort((a, b) => a[1].last_seen - b[1].last_seen)
    .map(([id, v]) => ({
      id,
      label: v.label,
      last_seen_s: Math.max(0, Math.round((now - v.last_seen) / 1000)),
    }));
}

function payload(now: number) {
  const store = getStore();
  return {
    revision: store.state.revision,
    hash: store.state.hash,
    updated_at: store.state.updated_at,
    peers: snapshotPeers(now),
  };
}

export async function GET() {
  return ok(payload(Date.now()));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { client_id?: unknown; label?: unknown } | null;
  const clientId = typeof body?.client_id === "string" && body.client_id.trim() ? body.client_id.trim().slice(0, 64) : null;
  if (!clientId) {
    return fail(400, "invalid_request", "client_id (string) é obrigatório no heartbeat de presença.");
  }
  const label =
    typeof body?.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 40)
      : `Operador-${clientId.slice(-4).toUpperCase()}`;

  const now = Date.now();
  const m = peersMap();
  if (!m.has(clientId)) {
    prunePeers(now);
    if (m.size >= PEER_MAX) {
      // lista cheia: expulsa o heartbeat mais antigo (mapa ordenado por inserção no pior caso)
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of m) {
        if (v.last_seen < oldest) {
          oldest = v.last_seen;
          oldestKey = k;
        }
      }
      if (oldestKey) m.delete(oldestKey);
    }
  }
  m.set(clientId, { last_seen: now, label });
  return ok(payload(now));
}
