/**
 * RELATÓRIO PDF DE DIFERENÇAS — compara duas revisões do ProjectDocument.
 * Uma folha A2 landscape: vistas frontais A/B coloridas por status de diff
 * (base cinza claro, mudanças em verde/laranja/vermelho), resumo numérico e
 * listas de IDs alterados. Sem pesos/materiais — foco em forma e geometria.
 * Mesmo aviso obrigatório do exportador canônico (esboço de referência).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import type { ProjectDocument } from "@/lib/cad/schema";
import { panelDimsOf } from "@/lib/cad/schema";
import { diffProjects, describeDiff } from "@/lib/cad/diff";
import {
  A2, RED, INK, GRAY, LIGHT, ORANGE, NAVY, GREEN, PDF_RED,
  sanitize, projectView, drawProjection,
  type RGB, type ViewBox, type ProjEl,
} from "./report";

export interface DiffPdfInput {
  currentDoc: ProjectDocument;
  currentRev: number;
  otherDoc: ProjectDocument;
  otherRev: number;
}

function statusColorA(status: string | undefined): RGB | undefined {
  if (status === "removed") return PDF_RED;
  if (status === "modified") return ORANGE;
  return undefined; // inalterado mantém cinza claro
}

function statusColorB(status: string | undefined): RGB | undefined {
  if (status === "added") return GREEN;
  if (status === "modified") return ORANGE;
  return undefined;
}

function drawHeader(page: PDFPage, bold: PDFFont, font: PDFFont, input: DiffPdfInput) {
  page.drawRectangle({ x: 0, y: A2.h - 44, width: A2.w, height: 44, color: rgb(0.985, 0.965, 0.955) });
  page.drawText(
    sanitize("ESBOÇO GEOMÉTRICO — NÃO DEFINE MATERIAL OU FABRICAÇÃO · RESPONSABILIDADE ESTRUTURAL DE PROFISSIONAL HABILITADO."),
    { x: 24, y: A2.h - 20, size: 10, font: bold, color: RED },
  );
  page.drawText("LED Collor CAD · RELATÓRIO DE DIFERENÇAS", { x: 24, y: A2.h - 36, size: 9, font, color: GRAY });
  page.drawText(
    sanitize(`REV ${String(input.otherRev).padStart(3, "0")} → ATUAL REV ${String(input.currentRev).padStart(3, "0")}`),
    { x: A2.w - 300, y: A2.h - 28, size: 13, font: bold, color: NAVY },
  );
}

function drawSummaryTable(
  page: PDFPage,
  x: number,
  yTop: number,
  input: DiffPdfInput,
  diff: ReturnType<typeof diffProjects>,
  font: PDFFont,
  bold: PDFFont,
): void {
  const { currentDoc, otherDoc, currentRev, otherRev } = input;
  const pd = (d: ProjectDocument) => {
    const p = panelDimsOf(d);
    return p ? `${p.width}×${p.height}` : "—";
  };
  const rows: Array<[string, string, string]> = [
    ["REVISÃO", `REV ${otherRev} (comparada)`, `REV ${currentRev} (atual)`],
    ["PAINEL", pd(otherDoc), pd(currentDoc)],
    ["ELEMENTOS", String(otherDoc.elements.length), String(currentDoc.elements.length)],
    ["ALTERAÇÕES", `+${diff.added.length}  ~${diff.modified.length}  -${diff.removed.length}`, ""],
  ];
  page.drawText(sanitize("RESUMO GEOMÉTRICO"), { x, y: yTop + 18, size: 12, font: bold, color: NAVY });
  const colW = [110, 170, 150];
  let ry = yTop;
  for (const [k, vb, va] of rows) {
    page.drawText(sanitize(k), { x, y: ry, size: 9, font: bold, color: GRAY });
    page.drawText(sanitize(vb).slice(0, 24), { x: x + colW[0], y: ry, size: 9.5, font, color: va === "" ? ORANGE : INK });
    page.drawText(sanitize(va).slice(0, 20), { x: x + colW[0] + colW[1], y: ry, size: 9.5, font, color: INK });
    ry -= 16;
  }
  page.drawText(sanitize(describeDiff(diff).slice(0, 60)), { x, y: ry - 6, size: 9, font: bold, color: ORANGE });
}

function drawIdList(
  page: PDFPage,
  x: number,
  yTop: number,
  w: number,
  title: string,
  color: RGB,
  ids: string[],
  font: PDFFont,
  bold: PDFFont,
): void {
  page.drawRectangle({ x: x - 6, y: yTop - 236, width: w + 12, height: 252, borderColor: LIGHT, borderWidth: 1 });
  page.drawText(sanitize(title), { x, y: yTop + 4, size: 10, font: bold, color });
  if (ids.length === 0) {
    page.drawText("— nenhuma —", { x, y: yTop - 16, size: 9, font, color: GRAY });
    return;
  }
  const perRow = Math.max(1, Math.floor(w / 92));
  const maxRows = 15; // cabe na caixa de 252pt
  const capacity = perRow * maxRows;
  const shown = ids.slice(0, capacity);
  let cx = x;
  let ry = yTop - 16;
  shown.forEach((id, i) => {
    page.drawText(sanitize(id).slice(0, 16), { x: cx, y: ry, size: 8, font, color });
    cx += 92;
    if ((i + 1) % perRow === 0) {
      cx = x;
      ry -= 13;
    }
  });
  if (ids.length > capacity) {
    page.drawText(sanitize(`+${ids.length - capacity} outros…`), { x, y: ry - 14, size: 8.5, font: bold, color: GRAY });
  }
}

function drawFooter(page: PDFPage, input: DiffPdfInput, font: PDFFont, bold: PDFFont, logo: PDFImage | null) {
  const w = 460;
  const h = 92;
  const x = A2.w - w - 24;
  const y = 24;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: NAVY, borderWidth: 1.5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y: y + h - 28, width: w, height: 28, color: NAVY });
  let subtitleX = x + 130;
  if (logo) {
    const lh = 18;
    const lw = lh * (logo.width / logo.height);
    page.drawRectangle({ x: x + 8, y: y + h - 25, width: lw + 10, height: 22, color: rgb(1, 1, 1) });
    page.drawImage(logo, { x: x + 13, y: y + h - 23, width: lw, height: lh });
    subtitleX = x + 13 + lw + 14;
  } else {
    page.drawText("LED COLLOR", { x: x + 12, y: y + h - 20, size: 15, font: bold, color: rgb(1, 1, 1) });
  }
  page.drawText(sanitize("RELATÓRIO DE DIFERENÇAS ENTRE REVISÕES"), { x: subtitleX, y: y + h - 18, size: 9, font, color: rgb(0.85, 0.87, 0.9) });
  const rows: Array<[string, string]> = [
    ["PROJETO", sanitize(input.currentDoc.project.name).slice(0, 52)],
    ["COMPARAÇÃO", `REV ${String(input.otherRev).padStart(3, "0")} → REV ${String(input.currentRev).padStart(3, "0")} · ${new Date().toLocaleString("pt-BR")}`],
    ["UNIDADE", "mm · comparação puramente geométrica (forma e dimensões)"],
  ];
  let ry = y + h - 46;
  for (const [k, v] of rows) {
    page.drawText(sanitize(k), { x: x + 12, y: ry, size: 8, font: bold, color: GRAY });
    page.drawText(sanitize(v).slice(0, 64), { x: x + 100, y: ry, size: 9.5, font, color: INK });
    ry -= 16;
  }
  page.drawText(
    sanitize("AVISO: ESBOÇO DE REFERÊNCIA GEOMÉTRICO — NÃO UTILIZAR PARA FABRICAÇÃO SEM REVISÃO TÉCNICA."),
    { x: 24, y: 32, size: 8.5, font: bold, color: RED },
  );
  page.drawText("LED Collor CAD", { x: 24, y: 18, size: 8, font, color: GRAY });
}

export async function generateDiffPdf(input: DiffPdfInput): Promise<Uint8Array> {
  const { currentDoc, otherDoc } = input;
  // semântica idêntica ao preview do sistema: old=atual, new=candidato (rev comparada)
  const diff = diffProjects(currentDoc, otherDoc);

  const removedSet = new Set(diff.removed);
  const addedSet = new Set(diff.added);
  const modifiedSet = new Set(diff.modified);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedPng(readFileSync(path.join(process.cwd(), "public", "logo-ledcollor.png")));
  } catch {
    logo = null;
  }
  const page: PDFPage = pdf.addPage([A2.w, A2.h]);
  drawHeader(page, bold, font, input);

  // ---------- vistas frontais A/B ----------
  const viewTop = A2.h - 76;
  const boxH = 560;
  const boxA: ViewBox = { x: 24, y: viewTop - boxH, w: 790, h: boxH };
  const boxB: ViewBox = { x: 830, y: viewTop - boxH, w: 790, h: boxH };

  const statusA: Record<string, string> = {};
  for (const el of currentDoc.elements) {
    statusA[el.id] = removedSet.has(el.id) ? "removed" : modifiedSet.has(el.id) ? "modified" : "unchanged";
  }
  const statusB: Record<string, string> = {};
  for (const el of otherDoc.elements) {
    statusB[el.id] = addedSet.has(el.id) ? "added" : modifiedSet.has(el.id) ? "modified" : "unchanged";
  }

  const projA = projectView(currentDoc, "front");
  const projB = projectView(otherDoc, "front");
  const byIdA = new Map<string, ProjEl>(projA.els.map((e) => [e.id, e]));
  const byIdB = new Map<string, ProjEl>(projB.els.map((e) => [e.id, e]));

  drawProjection(page, projA, boxA, bold, `ATUAL · REV ${input.currentRev} (vermelho = sai na restauração)`, {
    colorFor: (el) => statusColorA(statusA[byIdA.get(el.id)?.id ?? el.id] ?? "unchanged"),
  });
  drawProjection(page, projB, boxB, bold, `REV ${input.otherRev} · COMPARADA (verde = entra na restauração)`, {
    colorFor: (el) => statusColorB(statusB[byIdB.get(el.id)?.id ?? el.id] ?? "unchanged"),
  });

  // ---------- resumo + listas ----------
  const listTop = viewTop - boxH - 40;
  drawSummaryTable(page, 24, listTop, input, diff, font, bold);

  const listW = 340;
  const listGap = 20;
  const listX1 = 560;
  const listX2 = listX1 + listW + listGap;
  const listX3 = listX2 + listW + listGap;
  drawIdList(page, listX1, listTop, listW, `ENTRARIA NA RESTAURAÇÃO (${diff.added.length})`, GREEN, diff.added, font, bold);
  drawIdList(page, listX2, listTop, listW, `EDITADAS (${diff.modified.length})`, ORANGE, diff.modified, font, bold);
  drawIdList(page, listX3, listTop, listW, `SAIRIA NA RESTAURAÇÃO (${diff.removed.length})`, PDF_RED, diff.removed, font, bold);

  if (diff.panel_changed) {
    const pb = panelDimsOf(otherDoc);
    const pa = panelDimsOf(currentDoc);
    const fmt = (p: { width: number; height: number } | null) => (p ? `${p.width}×${p.height}` : "—");
    page.drawText(
      sanitize(`ATENÇÃO: dimensões do painel alteradas — ${fmt(pb)} (rev ${input.otherRev}) vs ${fmt(pa)} (atual).`),
      { x: 24, y: listTop - 260, size: 9.5, font: bold, color: ORANGE },
    );
  }

  drawFooter(page, input, font, bold, logo);
  return pdf.save();
}
