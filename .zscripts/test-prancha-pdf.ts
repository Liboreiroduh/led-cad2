/**
 * Verificação da prancha geométrica: gera PDFs de exemplo em download/.
 * Uso: bun .zscripts/test-prancha-pdf.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { referencePresets } from "../src/lib/cad/presets";
import { generateProjectPdf } from "../src/lib/pdf/report";
import { generateDiffPdf } from "../src/lib/pdf/diffReport";
import type { ProjectDocument } from "../src/lib/cad/schema";

/** Verificação de ORIENTAÇÃO: no PDF o y cresce para cima — a laje (z baixo)
 *  precisa de fill 're' em y BAIXO e o telhado (z alto) de paths com y negativo
 *  de grande magnitude (svg path é espelhado via cm 1 0 0 -1). */
function checkOrientation(buf: Buffer, tag: string): void {
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
    } catch { /* ignora */ }
  }
  // pares (posição Tm, texto Tj decodificado)
  const labels = [...text.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm[^B]*?<([0-9A-Fa-f]+)> Tj/g)]
    .map((m) => ({ x: +m[1], y: +m[2], s: Buffer.from(m[3], "hex").toString("latin1") }));
  const solo = labels.filter((l) => l.s.includes("SOLO"));
  const casa = labels.filter((l) => l.s.includes("CASA TESTE"));
  const soloY = solo.length ? Math.min(...solo.map((l) => l.y)) : -1;
  const casaY = casa.length ? Math.max(...casa.map((l) => l.y)) : -1;
  console.log(`[${tag}] SOLO y=${soloY.toFixed(0)} · CASA TESTE y=${casaY.toFixed(0)}`);
  const okSolo = soloY === -1 || soloY < 400; // solo ausente (PD=0) é válido
  const okCasa = casaY === -1 || casaY > 700;
  console.log(`  ${okSolo ? "OK solo/rodapé embaixo" : "FALHA: solo fora de posição"} · ${okCasa ? "OK topo em cima" : "FALHA: rótulo do topo não está em cima"}`);
  if (!okSolo || !okCasa) process.exitCode = 1;
}

async function main() {
  mkdirSync("download", { recursive: true });

  // Caso 1: preset de estrutura de painel (grupos, cadeias, encaixe)
  const presets = referencePresets();
  const first = [...presets.values()][0];
  if (!first) throw new Error("nenhum preset disponível");
  const bytes1 = await generateProjectPdf(first, 12);
  writeFileSync("download/teste-prancha-painel.pdf", bytes1);
  console.log(`OK painel: ${(bytes1.length / 1024).toFixed(0)} KB · ${first.elements.length} elementos`);

  // Caso 2: geometria livre (casa irregular + mesh + arco + cotas explícitas)
  const free: ProjectDocument = {
    schema_version: 2,
    units: "mm",
    project: { id: "CASA-LIVRE", name: "Casa livre (teste geometria)", description: "" },
    elements: [
      { id: "SLAB", geometry: { type: "box", center: { x: 3000, y: 2500, z: 150 }, size: [6000, 5000, 300] }, metadata: { group: "LAJE" } },
      { id: "PAREDE-A", geometry: { type: "box", center: { x: 3000, y: 250, z: 1650 }, size: [6000, 200, 3000] }, metadata: { group: "PAREDES" } },
      { id: "PAREDE-B", geometry: { type: "box", center: { x: 150, y: 2500, z: 1650 }, size: [300, 5000, 3000] }, metadata: { group: "PAREDES" } },
      { id: "AGUA", geometry: { type: "beam", start: { x: 0, y: 0, z: 3150 }, end: { x: 6000, y: 5000, z: 4400 }, section: { type: "square", width: 200, height: 200 } }, metadata: { group: "TELHADO" } },
      { id: "AGUA2", geometry: { type: "beam", start: { x: 6000, y: 0, z: 3150 }, end: { x: 0, y: 5000, z: 4400 }, section: { type: "square", width: 200, height: 200 } }, metadata: { group: "TELHADO" } },
      {
        id: "MESH-TELHADO",
        geometry: {
          type: "mesh",
          vertices: [
            { x: 0, y: 0, z: 3150 }, { x: 6000, y: 0, z: 3150 }, { x: 3000, y: 2500, z: 4400 }, { x: 0, y: 5000, z: 3150 }, { x: 6000, y: 5000, z: 3150 },
          ],
          faces: [[0, 1, 2], [0, 2, 3], [1, 4, 2], [3, 2, 4]],
        },
        metadata: { group: "TELHADO" },
      },
      { id: "ARCO", geometry: { type: "arc", center: { x: 3000, y: 250, z: 3150 }, radius: 1200, start_angle: 0, end_angle: 180, plane: "XZ", thickness: 60 }, metadata: { group: "DETALHE" } },
      { id: "COTA-LARG", geometry: { type: "dimension", start: { x: 0, y: 0, z: 0 }, end: { x: 6000, y: 0, z: 0 }, text: "6000" }, metadata: {} },
      { id: "ROTULO", geometry: { type: "text", position: { x: 3000, y: 0, z: 4700 }, text: "CASA TESTE", height: 220 }, metadata: {} },
    ],
    assumptions: ["Medidas estimadas visualmente do croqui do cliente (casa-livre)."],
    metadata: {},
  };
  const bytes2 = await generateProjectPdf(free, 3);
  writeFileSync("download/teste-prancha-livre.pdf", bytes2);
  console.log(`OK livre: ${(bytes2.length / 1024).toFixed(0)} KB · ${free.elements.length} elementos`);
  checkOrientation(Buffer.from(bytes1), "ORIENTAÇÃO painel (PD 500)");
  checkOrientation(Buffer.from(bytes2), "ORIENTAÇÃO casa livre");

  // Caso 3: PDF de diferenças (preset vs cópia modificada)
  const modified: ProjectDocument = structuredClone(first);
  modified.elements.push({
    id: "EXTRA-01",
    geometry: { type: "beam", start: { x: 0, y: 0, z: 0 }, end: { x: 500, y: 500, z: 2000 }, section: { type: "square", width: 80, height: 80 } },
    metadata: { group: "EXTRA" },
  });
  const bytes3 = await generateDiffPdf({ currentDoc: modified, currentRev: 13, otherDoc: first, otherRev: 12 });
  writeFileSync("download/teste-prancha-diff.pdf", bytes3);
  console.log(`OK diff: ${(bytes3.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error("FALHA:", e);
  process.exit(1);
});
