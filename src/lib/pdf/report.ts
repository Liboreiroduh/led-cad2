/**
 * PDF ÚNICO — exporter canônico (A2 landscape, template LED Collor).
 * Pipeline: ProjectDocument → projections → dimensions → plan_sheets → PDF.
 * AVISO OBRIGATÓRIO: esboço de referência geométrica.
 */
import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProjectDocument } from "@/lib/cad/schema";
import { deriveBom } from "@/lib/cad/bom";
import { getProfile } from "@/lib/cad/profiles";
import { validateProject } from "@/lib/cad/validation";

export const A2 = { w: 1683.78, h: 1190.55 }; // pt, landscape
export const MM = 72 / 25.4;
export const RED = rgb(0.78, 0.12, 0.12);
export const INK = rgb(0.13, 0.16, 0.2);
export const GRAY = rgb(0.45, 0.49, 0.54);
export const LIGHT = rgb(0.75, 0.78, 0.82);
export const ORANGE = rgb(0.9, 0.45, 0.05);
export const NAVY = rgb(0.1, 0.15, 0.22);
export const GREEN = rgb(0.09, 0.64, 0.34);
export const PDF_RED = rgb(0.85, 0.15, 0.15);

interface Pt {
  x: number;
  y: number;
}
export interface Prim {
  kind: "line" | "rect" | "circle";
  a?: Pt;
  b?: Pt;
  p?: Pt;
  w?: number; // rect width (view units)
  h?: number;
  r?: number;
  thickness: number; // mm for lines
  color?: ReturnType<typeof rgb>;
  fill?: boolean;
}

export type RGB = ReturnType<typeof rgb>;

export function sanitize(text: string): string {
  return text
    .replace(/\u2192/g, "->") // → não existe em WinAnsi (Helvetica padrão)
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, "-");
}

/**
 * Projeção ortográfica do documento (front/side/top) para primitivas PDF.
 * `colorFor` opcional permite sobrescrever a cor por elemento (diff com status).
 */
export function project(
  doc: ProjectDocument,
  view: "front" | "side" | "top",
  colorFor?: (el: ProjectDocument["elements"][number]) => RGB | undefined,
): { prims: Prim[]; bbox: { min: Pt; max: Pt } } {
  const prims: Prim[] = [];
  const map = (x: number, y: number, z: number): Pt => {
    if (view === "front") return { x, y: z };
    if (view === "side") return { x: y, y: z };
    return { x, y };
  };
  const grow = (p: Pt, pad = 0) => {
    bbox.min.x = Math.min(bbox.min.x, p.x - pad);
    bbox.min.y = Math.min(bbox.min.y, p.y - pad);
    bbox.max.x = Math.max(bbox.max.x, p.x + pad);
    bbox.max.y = Math.max(bbox.max.y, p.y + pad);
  };
  const bbox = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };

  for (const el of doc.elements) {
    const override = colorFor?.(el);
    if (el.type === "beam") {
      const prof = getProfile(el.profile);
      const t = prof ? prof.w : 40;
      const a = map(el.start.x, el.start.y, el.start.z);
      const b = map(el.end.x, el.end.y, el.end.z);
      prims.push({ kind: "line", a, b, thickness: t, color: override ?? INK });
      grow(a, t / 2);
      grow(b, t / 2);
    } else if (el.type === "cable") {
      const a = map(el.start.x, el.start.y, el.start.z);
      const b = map(el.end.x, el.end.y, el.end.z);
      prims.push({ kind: "line", a, b, thickness: el.diameter, color: override ?? GRAY });
      grow(a, el.diameter / 2);
      grow(b, el.diameter / 2);
    } else if (el.type === "plate") {
      const c = map(el.center.x, el.center.y, el.center.z);
      const sx = view === "side" ? el.size_y : el.size_x;
      const sy = view === "top" ? el.size_y : el.size_z;
      prims.push({ kind: "rect", p: { x: c.x - sx / 2, y: c.y - sy / 2 }, w: sx, h: sy, thickness: 1, color: override ?? INK });
      grow({ x: c.x - sx / 2, y: c.y - sy / 2 });
      grow({ x: c.x + sx / 2, y: c.y + sy / 2 });
    } else if (el.type === "panel") {
      const c = map(el.center.x, el.center.y, el.center.z);
      const sx = view === "side" ? el.size_y : el.size_x;
      const sy = view === "top" ? el.size_y : el.size_z;
      prims.push({ kind: "rect", p: { x: c.x - sx / 2, y: c.y - sy / 2 }, w: sx, h: sy, thickness: 1.5, color: override ?? NAVY });
      grow({ x: c.x - sx / 2, y: c.y - sy / 2 });
      grow({ x: c.x + sx / 2, y: c.y + sy / 2 });
    } else if (el.type === "bolt") {
      const c = map(el.center.x, el.center.y, el.center.z);
      prims.push({ kind: "circle", p: c, r: el.diameter / 2, thickness: 0.8, color: override ?? GRAY });
      grow(c, el.diameter);
    } else if (el.type === "surface") {
      let prev: Pt | null = null;
      for (const pt of el.points) {
        const p = map(pt.x, pt.y, pt.z);
        grow(p);
        if (prev) prims.push({ kind: "line", a: prev, b: p, thickness: 1.2, color: INK });
        prev = p;
      }
      if (prev && el.points.length) {
        const first = map(el.points[0].x, el.points[0].y, el.points[0].z);
        prims.push({ kind: "line", a: prev, b: first, thickness: 1.2, color: INK });
      }
    }
  }
  if (!isFinite(bbox.min.x)) {
    bbox.min = { x: -1000, y: -1000 };
    bbox.max = { x: 1000, y: 1000 };
  }
  return { prims, bbox };
}

function isoProject(doc: ProjectDocument): { prims: Prim[]; bbox: { min: Pt; max: Pt } } {
  const prims: Prim[] = [];
  const bbox = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  const map = (x: number, y: number, z: number): Pt => ({
    x: (x - y) * Math.cos(Math.PI / 6),
    y: z + (x + y) * Math.sin(Math.PI / 6) * 0.35,
  });
  const grow = (p: Pt, pad = 0) => {
    bbox.min.x = Math.min(bbox.min.x, p.x - pad);
    bbox.min.y = Math.min(bbox.min.y, p.y - pad);
    bbox.max.x = Math.max(bbox.max.x, p.x + pad);
    bbox.max.y = Math.max(bbox.max.y, p.y + pad);
  };
  for (const el of doc.elements) {
    if (el.type === "beam") {
      const prof = getProfile(el.profile);
      const t = prof ? Math.max(2, prof.w * 0.5) : 20;
      const a = map(el.start.x, el.start.y, el.start.z);
      const b = map(el.end.x, el.end.y, el.end.z);
      prims.push({ kind: "line", a, b, thickness: t, color: INK });
      grow(a, t);
      grow(b, t);
    } else if (el.type === "cable") {
      const a = map(el.start.x, el.start.y, el.start.z);
      const b = map(el.end.x, el.end.y, el.end.z);
      prims.push({ kind: "line", a, b, thickness: Math.max(2, el.diameter * 0.5), color: GRAY });
      grow(a);
      grow(b);
    } else if (el.type === "plate" || el.type === "panel") {
      const sx = el.size_x / 2;
      const sy = el.size_y / 2;
      const sz = el.size_z / 2;
      const cx = el.center.x;
      const cy = el.center.y;
      const cz = el.center.z;
      const corners: Array<[number, number, number]> = [
        [cx - sx, cy - sy, cz - sz],
        [cx + sx, cy - sy, cz - sz],
        [cx + sx, cy + sy, cz - sz],
        [cx - sx, cy + sy, cz - sz],
        [cx - sx, cy - sy, cz + sz],
        [cx + sx, cy - sy, cz + sz],
        [cx + sx, cy + sy, cz + sz],
        [cx - sx, cy + sy, cz + sz],
      ];
      const edges: Array<[number, number]> = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ];
      for (const [i, j] of edges) {
        const a = map(...corners[i]);
        const b = map(...corners[j]);
        prims.push({ kind: "line", a, b, thickness: 1, color: el.type === "panel" ? NAVY : INK });
        grow(a);
        grow(b);
      }
    } else if (el.type === "bolt") {
      const c = map(el.center.x, el.center.y, el.center.z);
      prims.push({ kind: "circle", p: c, r: el.diameter / 2, thickness: 0.8, color: GRAY });
      grow(c, el.diameter);
    } else if (el.type === "surface") {
      let prev: Pt | null = null;
      for (const pt of el.points) {
        const p = map(pt.x, pt.y, pt.z);
        grow(p);
        if (prev) prims.push({ kind: "line", a: prev, b: p, thickness: 1, color: INK });
        prev = p;
      }
      if (prev && el.points.length) {
        prims.push({ kind: "line", a: prev, b: map(el.points[0].x, el.points[0].y, el.points[0].z), thickness: 1, color: INK });
      }
    }
  }
  if (!isFinite(bbox.min.x)) {
    bbox.min = { x: -1000, y: -1000 };
    bbox.max = { x: 1000, y: 1000 };
  }
  return { prims, bbox };
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function drawView(page: PDFPage, prims: Prim[], bbox: { min: Pt; max: Pt }, box: ViewBox, font: PDFFont, label: string, scaleNote: { value: number }) {
  // frame
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    borderColor: LIGHT,
    borderWidth: 1,
  });
  const pad = 30;
  const bw = Math.max(1, bbox.max.x - bbox.min.x);
  const bh = Math.max(1, bbox.max.y - bbox.min.y);
  const scale = Math.min((box.w - pad * 2) / bw, (box.h - pad * 2) / bh);
  scaleNote.value = scale;
  const toPage = (p: Pt): Pt => ({
    x: box.x + pad + (p.x - bbox.min.x) * scale,
    y: box.y + box.h - pad - (p.y - bbox.min.y) * scale,
  });
  for (const pr of prims) {
    if (pr.kind === "line") {
      const a = toPage(pr.a!);
      const b = toPage(pr.b!);
      page.drawLine({
        start: a,
        end: b,
        thickness: Math.max(0.6, pr.thickness * scale * MM * 0.5),
        color: pr.color ?? INK,
        lineCap: LineCapStyle.Round,
      });
    } else if (pr.kind === "rect") {
      const p1 = toPage(pr.p!);
      const p2 = toPage({ x: pr.p!.x + pr.w!, y: pr.p!.y + pr.h! });
      page.drawRectangle({
        x: p1.x,
        y: p2.y,
        width: p2.x - p1.x,
        height: p1.y - p2.y,
        borderColor: pr.color ?? INK,
        borderWidth: Math.max(0.8, pr.thickness),
        borderOpacity: pr.fill === false ? 1 : 0.9,
        opacity: 0.08,
      });
    } else if (pr.kind === "circle") {
      const c = toPage(pr.p!);
      page.drawCircle({
        x: c.x,
        y: c.y,
        size: Math.max(1.2, pr.r! * scale * MM),
        borderColor: pr.color ?? GRAY,
        borderWidth: 0.8,
      });
    }
  }
  page.drawText(sanitize(label), {
    x: box.x + 10,
    y: box.y + box.h - 18,
    size: 13,
    font,
    color: NAVY,
  });
}

function drawDimension(
  page: PDFPage,
  a: Pt,
  b: Pt,
  offset: number,
  label: string,
  font: PDFFont,
  horizontal = true,
) {
  const tick = 6;
  if (horizontal) {
    const y = a.y - offset;
    page.drawLine({ start: { x: a.x, y }, end: { x: b.x, y }, thickness: 0.8, color: ORANGE });
    page.drawLine({ start: { x: a.x, y: y - tick }, end: { x: a.x, y: y + tick }, thickness: 0.8, color: ORANGE });
    page.drawLine({ start: { x: b.x, y: y - tick }, end: { x: b.x, y: y + tick }, thickness: 0.8, color: ORANGE });
    const tw = (font.widthOfTextAtSize(label, 10) * 11) / 10;
    page.drawRectangle({ x: (a.x + b.x) / 2 - tw / 2 - 3, y: y - 5, width: tw + 6, height: 12, color: rgb(1, 1, 1) });
    page.drawText(label, { x: (a.x + b.x) / 2 - tw / 2, y: y - 3.5, size: 10, font, color: ORANGE });
  } else {
    const x = a.x - offset;
    page.drawLine({ start: { x, y: a.y }, end: { x, y: b.y }, thickness: 0.8, color: ORANGE });
    page.drawLine({ start: { x: x - tick, y: a.y }, end: { x: x + tick, y: a.y }, thickness: 0.8, color: ORANGE });
    page.drawLine({ start: { x: x - tick, y: b.y }, end: { x: x + tick, y: b.y }, thickness: 0.8, color: ORANGE });
    const angle = Math.PI / 2;
    page.drawText(label, {
      x: x - 4,
      y: (a.y + b.y) / 2 - (font.widthOfTextAtSize(label, 10) / 2) * Math.cos(angle) + 6,
      size: 10,
      font,
      color: ORANGE,
      rotate: { type: "degrees", angle: 90 } as never,
    });
  }
}

function drawTitleBlock(page: PDFPage, doc: ProjectDocument, revision: number, sheet: string, totalWeight: number, font: PDFFont, bold: PDFFont) {
  const w = 460;
  const h = 150;
  const x = A2.w - w - 24;
  const y = 24;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: NAVY, borderWidth: 1.5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y: y + h - 34, width: w, height: 34, color: NAVY });
  page.drawText("LED COLLOR", { x: x + 12, y: y + h - 25, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(sanitize("ESBOÇO GEOMÉTRICO — PROJECT JSON"), { x: x + 150, y: y + h - 22, size: 10, font, color: rgb(0.85, 0.87, 0.9) });
  const rows: Array<[string, string]> = [
    ["PROJETO", sanitize(doc.project.name)],
    ["ID / REV", `${doc.project.id}  ·  REV ${String(revision).padStart(3, "0")}`],
    ["PAINEL", `${doc.panel.width} x ${doc.panel.height} x ${doc.panel.depth} mm  ·  PD ${doc.panel.ground_clearance} mm`],
    ["DATA / UNID", `${new Date().toLocaleDateString("pt-BR")}  ·  mm  ·  ${doc.elements.length} elementos`],
    ["PESO ESTIMADO", `${totalWeight.toFixed(0)} kg  ·  FOLHA ${sheet}`],
  ];
  let ry = y + h - 52;
  for (const [k, v] of rows) {
    page.drawText(sanitize(k), { x: x + 12, y: ry, size: 8, font: bold, color: GRAY });
    page.drawText(sanitize(v).slice(0, 64), { x: x + 110, y: ry, size: 10, font, color: INK });
    ry -= 20;
  }
  page.drawText(
    sanitize("AVISO: ESBOÇO DE REFERÊNCIA GEOMÉTRICO — NÃO UTILIZAR PARA FABRICAÇÃO SEM REVISÃO TÉCNICA."),
    { x: x + 12, y: y + 6, size: 7.5, font: bold, color: RED },
  );
}

function drawBanner(page: PDFPage, font: PDFFont, bold: PDFFont, sheetTitle: string) {
  page.drawRectangle({ x: 0, y: A2.h - 40, width: A2.w, height: 40, color: rgb(0.97, 0.9, 0.88) });
  page.drawText(sanitize("ESBOÇO DE REFERÊNCIA GEOMÉTRICO — NÃO UTILIZAR PARA FABRICAÇÃO SEM REVISÃO TÉCNICA."), {
    x: 24,
    y: A2.h - 27,
    size: 11,
    font: bold,
    color: RED,
  });
  page.drawText(sanitize(sheetTitle), { x: A2.w - 260, y: A2.h - 27, size: 12, font: bold, color: NAVY });
  page.drawText("LED JSON CAD · LED Collor", { x: 24, y: 30, size: 9, font, color: GRAY });
}

export async function generateProjectPdf(raw: unknown, revision: number): Promise<Uint8Array> {
  const check = validateProject(raw);
  if (!check.ok) {
    throw new Error(`documento inválido para PDF: ${check.errors[0]?.message ?? "erro"}`);
  }
  const doc = check.hash ? (raw as ProjectDocument) : null;
  if (!doc) throw new Error("documento inválido");
  const bom = deriveBom(doc);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // ---------- PÁGINA 1: VISTAS ----------
  const p1 = pdf.addPage([A2.w, A2.h]);
  drawBanner(p1, font, bold, "VISTAS · FRONTAL / LATERAL / SUPERIOR");

  const front = project(doc, "front");
  const side = project(doc, "side");
  const top = project(doc, "top");
  const s1 = { value: 1 };
  const s2 = { value: 1 };
  const s3 = { value: 1 };

  const contentTop = A2.h - 70;
  const frontBox = { x: 24, y: contentTop - 620, w: 900, h: 620 };
  const sideBox = { x: 950, y: contentTop - 620, w: 440, h: 620 };
  const topBox = { x: 24, y: 200, w: 900, h: 300 };
  const notesBoxX = 950;

  drawView(p1, front.prims, front.bbox, frontBox, bold, "FRONTAL", s1);
  drawView(p1, side.prims, side.bbox, sideBox, bold, "LATERAL", s2);
  drawView(p1, top.prims, top.bbox, topBox, bold, "SUPERIOR", s3);

  // Cotas derivadas do modelo
  const fx = (v: number) => frontBox.x + 30 + (v - front.bbox.min.x) * s1.value;
  const fy = (v: number) => frontBox.y + frontBox.h - 30 - (v - front.bbox.min.y) * s1.value;
  drawDimension(
    p1,
    { x: fx(front.bbox.min.x), y: fy(front.bbox.min.y) },
    { x: fx(front.bbox.max.x), y: fy(front.bbox.min.y) },
    26,
    `${Math.round(front.bbox.max.x - front.bbox.min.x)} mm`,
    font,
    true,
  );
  drawDimension(
    p1,
    { x: fx(front.bbox.max.x), y: fy(front.bbox.max.y) },
    { x: fx(front.bbox.max.x), y: fy(front.bbox.min.y) },
    26,
    `${Math.round(front.bbox.max.y - front.bbox.min.y)} mm`,
    font,
    false,
  );
  const sx = (v: number) => sideBox.x + 30 + (v - side.bbox.min.x) * s2.value;
  const sy = (v: number) => sideBox.y + sideBox.h - 30 - (v - side.bbox.min.y) * s2.value;
  drawDimension(
    p1,
    { x: sx(side.bbox.min.x), y: sy(side.bbox.min.y) },
    { x: sx(side.bbox.max.x), y: sy(side.bbox.min.y) },
    22,
    `${Math.round(side.bbox.max.x - side.bbox.min.x)} mm`,
    font,
    true,
  );

  // Notas / assumptions
  p1.drawText(sanitize("NOTAS E ASSUMPTIONS"), { x: notesBoxX, y: 200 - 24, size: 12, font: bold, color: NAVY });
  const notes = [
    `Instalação: ${doc.installation.type} · Ambiente: ${doc.installation.environment}`,
    ...doc.assumptions.slice(0, 6).map((a) => `- ${typeof a === "string" ? a : `${a.detail} (${a.path})`}`),
    "- Bays estruturais ≠ grade de gabinetes.",
  ];
  let ny = 200 - 48;
  for (const n of notes) {
    p1.drawText(sanitize(n).slice(0, 72), { x: notesBoxX, y: ny, size: 9, font, color: INK });
    ny -= 14;
  }

  drawTitleBlock(p1, doc, revision, "1/2", bom.total_weight_kg, font, bold);

  // ---------- PÁGINA 2: ISOMÉTRICA + BOM ----------
  const p2 = pdf.addPage([A2.w, A2.h]);
  drawBanner(p2, font, bold, "ISOMÉTRICA + LISTA DE MATERIAIS");
  const iso = isoProject(doc);
  const s4 = { value: 1 };
  drawView(p2, iso.prims, iso.bbox, { x: 24, y: A2.h - 70 - 560, w: 760, h: 560 }, bold, "ISOMÉTRICA (referência visual)", s4);

  // Tabela BOM
  const bx = 24;
  const byTop = 430;
  const colW = [50, 460, 90, 150, 130];
  p2.drawText(sanitize("LISTA DE MATERIAIS (BOM) — derivada do ProjectDocument"), { x: bx, y: byTop + 22, size: 13, font: bold, color: NAVY });
  const headers = ["ITEM", "DESCRIÇÃO", "QTD", "COMP. TOTAL (m)", "PESO (kg)"];
  let cx = bx;
  for (let i = 0; i < headers.length; i++) {
    p2.drawText(headers[i], { x: cx + 6, y: byTop, size: 9, font: bold, color: GRAY });
    cx += colW[i];
  }
  p2.drawLine({ start: { x: bx, y: byTop - 6 }, end: { x: bx + colW.reduce((a, b) => a + b, 0), y: byTop - 6 }, thickness: 1, color: NAVY });
  let ry = byTop - 26;
  for (const row of bom.rows.slice(0, 14)) {
    cx = bx;
    const vals = [row.item, row.description, String(row.qty), row.total_length_m?.toFixed(2) ?? "-", row.total_weight_kg.toFixed(1)];
    for (let i = 0; i < vals.length; i++) {
      p2.drawText(sanitize(vals[i]).slice(0, 60), { x: cx + 6, y: ry, size: 9, font, color: INK });
      cx += colW[i];
    }
    ry -= 18;
  }
  p2.drawLine({ start: { x: bx, y: ry + 8 }, end: { x: bx + colW.reduce((a, b) => a + b, 0), y: ry + 8 }, thickness: 0.8, color: LIGHT });
  p2.drawText(sanitize(`TOTAL ESTIMADO: ${bom.total_weight_kg.toFixed(1)} kg · ${bom.element_count} elementos`), {
    x: bx + 6,
    y: ry - 10,
    size: 10,
    font: bold,
    color: INK,
  });

  drawTitleBlock(p2, doc, revision, "2/2", bom.total_weight_kg, font, bold);

  return pdf.save();
}
