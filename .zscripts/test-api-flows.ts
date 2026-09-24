/**
 * Testa os fluxos da API local com o projeto REAL importado (data/project.json):
 * preview → apply → undo → bom → pdf (+ transform quando provider=mock).
 * Uso: bun .zscripts/test-api-flows.ts
 */
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
let failed = 0;

async function step(name: string, fn: () => Promise<string>): Promise<string> {
  try {
    const msg = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("TIMEOUT 20s — endpoint travou o servidor")), 20000)),
    ]);
    console.log(`OK   ${name}${msg ? ` — ${msg}` : ""}`);
    return msg;
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}:`, (e as Error).message);
    return "";
  }
}

const raw = JSON.parse(readFileSync("data/project.json", "utf8"));
const doc = (raw as { project?: unknown }).project ?? raw;
const cfg = JSON.parse(readFileSync("data/ai_config.json", "utf8")) as { provider?: string };
console.log("provider ativo:", cfg.provider ?? "(nenhum)");

await step("GET /api/project", async () => {
  const r = await fetch(`${BASE}/api/project`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { revision: number; hash: string; project: { elements: unknown[] } };
  return `rev ${j.revision} · ${j.project.elements.length} elementos`;
});

// candidato = doc atual + 1 elemento novo
const candidate = JSON.parse(JSON.stringify(doc)) as { elements: Array<Record<string, unknown>>; project: { id: string } };
candidate.elements.push({
  id: "TESTE-FLOW-01",
  geometry: { type: "beam", start: { x: 0, y: 0, z: 0 }, end: { x: 300, y: 300, z: 1800 }, section: { type: "square", width: 60, height: 60 } },
  metadata: { group: "TESTE" },
});

let baseRevision = 0;
let baseHash = "";
await step("POST /api/project (captura base)", async () => {
  const r = await fetch(`${BASE}/api/project`);
  const j = (await r.json()) as { revision: number; hash: string };
  baseRevision = j.revision;
  baseHash = j.hash;
  return `rev ${baseRevision}`;
});

await step("POST /api/preview", async () => {
  const r = await fetch(`${BASE}/api/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { ok: boolean; diff: { counts: { added: number } } };
  if (!j.ok) throw new Error("preview não-ok");
  return `+${j.diff.counts.added} adicionado(s)`;
});

await step("POST /api/apply", async () => {
  const r = await fetch(`${BASE}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate, base_revision: baseRevision, base_hash: baseHash, origin: "json" }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { revision: number };
  return `rev ${j.revision}`;
});

await step("POST /api/undo", async () => {
  const r = await fetch(`${BASE}/api/undo`, { method: "POST" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { revision: number };
  return `voltou para rev ${j.revision}`;
});

await step("POST /api/export/bom", async () => {
  const r = await fetch(`${BASE}/api/export/bom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: doc }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return "bom ok";
});

await step("POST /api/export/pdf", async () => {
  const r = await fetch(`${BASE}/api/export/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: doc }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return `${(buf.byteLength / 1024).toFixed(0)} KB`;
});

if (cfg.provider === "mock") {
  await step("POST /api/ai/transform (mock)", async () => {
    const r = await fetch(`${BASE}/api/ai/transform`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "adicione uma barra diagonal no primeiro vão" }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { status: string };
    return `status ${j.status}`;
  });
} else {
  console.log("SKIP /api/ai/transform (provider não é mock no local)");
}

if (failed > 0) {
  console.error(`\n${failed} passo(s) falharam`);
  process.exit(1);
}
console.log("\nTodos os fluxos OK");
