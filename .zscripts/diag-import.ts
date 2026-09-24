/**
 * DIAGNÓSTICO — reproduz os fluxos com o projeto real importado (data/project.json):
 *  1) valida/normaliza (v1→v2), diff, hash, BOM, prompt de IA
 *  2) gera o PDF e analisa a ORIENTAÇÃO do conteúdo no stream (preenchimentos x linhas)
 * Uso: bun .zscripts/diag-import.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { validateProject } from "../src/lib/cad/validation";
import { isLegacyProject } from "../src/lib/cad/legacy-adapter";
import { diffProjects } from "../src/lib/cad/diff";
import { canonicalJson, projectHash } from "../src/lib/cad/hashing";
import { deriveBom } from "../src/lib/cad/bom";
import { generateProjectPdf } from "../src/lib/pdf/report";
import { PDFDocument } from "pdf-lib";

const step = (name: string, fn: () => unknown) => {
  try {
    const r = fn();
    console.log(`OK   ${name}`);
    return r;
  } catch (e) {
    console.error(`FAIL ${name}:`, (e as Error)?.stack ?? e);
    return undefined;
  }
};

const raw = JSON.parse(readFileSync("data/project.json", "utf8"));
const proj = (raw as { project?: unknown }).project ?? raw;

console.log("== DOC ==");
console.log("keys:", Object.keys(proj as object).join(","));
console.log("legacy v1?", step("isLegacyProject", () => isLegacyProject(proj as never)));

const check = step("validateProject", () => validateProject(proj)) as ReturnType<typeof validateProject> | undefined;
if (!check?.ok || !check.doc) {
  console.error("documento inválido — erros:", check && !check.ok ? check.errors.slice(0, 5) : "?");
  process.exit(1);
}
const doc = check.doc;
console.log("elementos:", doc.elements.length);
const types: Record<string, number> = {};
let zMin = Infinity;
let zMax = -Infinity;
for (const el of doc.elements) {
  types[el.geometry.type] = (types[el.geometry.type] ?? 0) + 1;
  const pts: Array<{ x: number; y: number; z: number }> = [];
  const g = el.geometry as never as { points?: unknown[]; start?: { z: number }; end?: { z: number }; center?: { z: number }; vertices?: Array<{ z: number }> };
  if (g.start) pts.push(g.start as never);
  if (g.end) pts.push(g.end as never);
  if (g.center) pts.push(g.center as never);
  if (Array.isArray(g.points)) pts.push(...(g.points as never[]));
  if (Array.isArray(g.vertices)) pts.push(...g.vertices);
  for (const p of pts) {
    if (typeof p?.z === "number" && isFinite(p.z)) {
      zMin = Math.min(zMin, p.z);
      zMax = Math.max(zMax, p.z);
    }
  }
}
console.log("tipos:", JSON.stringify(types));
console.log("faixa Z:", isFinite(zMin) ? `${zMin} .. ${zMax}` : "n/a");

step("diffProjects (auto)", () => diffProjects(doc, doc));
step("projectHash", () => projectHash(doc));
step("deriveBom", () => deriveBom(doc).total_weight_kg);

let bytes: Uint8Array | undefined;
try {
  bytes = await generateProjectPdf(doc, 1);
  console.log("OK   generateProjectPdf");
} catch (e) {
  console.error("FAIL generateProjectPdf:", (e as Error)?.stack ?? e);
}
if (bytes) {
  writeFileSync("download/diag-atual.pdf", bytes);
  // análise de orientação: compara a altura-na-página dos fills (re / path) com as linhas
  await analyzeOrientation(bytes, "download/diag-atual.pdf (projeto importado)");
}
console.log("== FIM ==");

/** Analisa a orientação dos preenchimentos no stream do PDF (brute-force inflate). */
async function analyzeOrientation(bytes: Uint8Array, tag: string): Promise<void> {
  const pdf = await PDFDocument.load(bytes);
  const buf = Buffer.from(bytes);
  let text = "";
  let i = 0;
  while ((i = buf.indexOf("stream", i + 1)) !== -1) {
    let s = i + 6;
    if (buf[s] === 13) s++;
    if (buf[s] === 10) s++;
    const e = buf.indexOf("endstream", s);
    if (e === -1) break;
    try {
      text += inflateSync(buf.subarray(s, e)).toString("latin1") + "\n";
    } catch { /* stream binário/imagem — ignora */ }
  }
  // orientação via rótulos: "SOLO +/-0" (z=0) deve ficar em y BAIXO da folha
  const labels = [...text.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm[^B]*?<([0-9A-Fa-f]+)> Tj/g)]
    .map((m) => ({ x: +m[1], y: +m[2], s: Buffer.from(m[3], "hex").toString("latin1") }));
  const solo = labels.filter((l) => l.s.includes("SOLO"));
  const soloY = solo.length ? Math.min(...solo.map((l) => l.y)) : -1;
  console.log(`[${tag}] páginas=${pdf.getPageCount()} · rótulo SOLO y=${soloY.toFixed(0)} (esperado <400; -1 = sem solo, PD=0)`);
  if (soloY >= 400) {
    console.error("  FALHA DE ORIENTAÇÃO: solo não está embaixo!");
    process.exitCode = 1;
  } else {
    console.log("  OK: orientação vertical correta (solo embaixo)");
  }
}
