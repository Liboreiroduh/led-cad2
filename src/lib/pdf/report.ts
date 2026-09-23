/**
 * PDF ÚNICO — exporter canônico (A2 landscape, template LED Collor).
 * Pipeline: GeometryDocument → segmentos 3D genéricos → projeções → PDF.
 * O PDF deriva da GEOMETRIA (nunca de material/perfil).
 * AVISO OBRIGATÓRIO: esboço de referência geométrica.
 */
import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProjectDocument, GeometryElement } from "@/lib/cad/schema";
import { panelDimsOf, installationOf } from "@/lib/cad/schema";
import { deriveBom } from "@/lib/cad/bom";
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

/* ==================== EXTRAÇÃO GEOMÉTRICA GENÉRICA ==================== */

type V3 = { x: number; y: number; z: number };
interface Seg3 {
  a: V3;
  b: V3;
  thickness: number;
}

const dist3 = (a: V3, b: V3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

function boxCorners(center: V3, size: [number, number, number], rotation?: [number, number, number]): V3[] {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const local: V3[] = [];
  for (const dx of [-sx, sx]) for (const dy of [-sy, sy]) for (const dz of [-sz, sz]) local.push({ x: dx, y: dy, z: dz });
  if (!rotation || rotation.every((r) => r === 0)) {
    return local.map((p) => ({ x: center.x + p.x, y: center.y + p.y, z: center.z + p.z }));
  }
  const rad = rotation.map((d) => (d * Math.PI) / 180);
  const rot = (p: V3): V3 => {
    // ordem X → Y → Z
    let { x, y, z } = p;
    [y, z] = [y * Math.cos(rad[0]) - z * Math.sin(rad[0]), y * Math.sin(rad[0]) + z * Math.cos(rad[0])];
    [x, z] = [x * Math.cos(rad[1]) + z * Math.sin(rad[1]), -x * Math.sin(rad[1]) + z * Math.cos(rad[1])];
    [x, y] = [x * Math.cos(rad[2]) - y * Math.sin(rad[2]), x * Math.sin(rad[2]) + y * Math.cos(rad[2])];
    return { x, y, z };
  };
  return local.map((p) => {
    const r = rot(p);
    return { x: center.x + r.x, y: center.y + r.y, z: center.z + r.z };
  });
}

const BOX_EDGES: Array<[number, number]> = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function planePoint(plane: string, c: V3, r: number, angleRad: number): V3 {
  if (plane === "XY") return { x: c.x + r * Math.cos(angleRad), y: c.y + r * Math.sin(angleRad), z: c.z };
  if (plane === "YZ") return { x: c.x, y: c.y + r * Math.cos(angleRad), z: c.z + r * Math.sin(angleRad) };
  return { x: c.x + r * Math.cos(angleRad), y: c.y, z: c.z + r * Math.sin(angleRad) };
}

/** Converte QUALQUER primitivo em segmentos 3D — PDF deriva da geometria, ponto final. */
export function elementSegments(el: GeometryElement): Seg3[] {
  const g = el.geometry;
  switch (g.type) {
    case "line":
      return [{ a: g.start, b: g.end, thickness: Math.max(g.thickness ?? 8, 1) }];
    case "beam":
      return [{ a: g.start, b: g.end, thickness: g.section.type === "round" ? g.section.diameter : g.section.width }];
    case "cylinder":
      return [{ a: g.start, b: g.end, thickness: g.diameter }];
    case "polyline": {
      const t = Math.max(g.thickness ?? 8, 1);
      const segs: Seg3[] = [];
      const pts = g.points;
      for (let i = 1; i < pts.length; i++) segs.push({ a: pts[i - 1], b: pts[i], thickness: t });
      if (g.closed && pts.length > 2) segs.push({ a: pts[pts.length - 1], b: pts[0], thickness: t });
      return segs;
    }
    case "box": {
      const corners = boxCorners(g.center, g.size, g.rotation);
      return BOX_EDGES.map(([i, j]) => ({ a: corners[i], b: corners[j], thickness: 1 }));
    }
    case "circle": {
      const segs: Seg3[] = [];
      const n = 64;
      for (let i = 0; i < n; i++) {
        segs.push({
          a: planePoint(g.plane ?? "XY", g.center, g.radius, (i / n) * Math.PI * 2),
          b: planePoint(g.plane ?? "XY", g.center, g.radius, ((i + 1) / n) * Math.PI * 2),
          thickness: 1.5,
        });
      }
      return segs;
    }
    case "arc": {
      const segs: Seg3[] = [];
      const span = g.end_angle - g.start_angle;
      const n = Math.max(8, Math.min(96, Math.ceil(Math.abs(span) / 4)));
      for (let i = 0; i < n; i++) {
        segs.push({
          a: planePoint(g.plane ?? "XY", g.center, g.radius, ((g.start_angle + (span * i) / n) * Math.PI) / 180),
          b: planePoint(g.plane ?? "XY", g.center, g.radius, ((g.start_angle + (span * (i + 1)) / n) * Math.PI) / 180),
          thickness: Math.max(g.thickness ?? 2, 1),
        });
      }
      return segs;
    }
    case "polygon":
    case "surface": {
      const segs: Seg3[] = [];
      const pts = g.points;
      for (let i = 1; i < pts.length; i++) segs.push({ a: pts[i - 1], b: pts[i], thickness: 1.2 });
      if (pts.length > 2) segs.push({ a: pts[pts.length - 1], b: pts[0], thickness: 1.2 });
      return segs;
    }
    case "mesh": {
      const segs: Seg3[] = [];
      const seen = new Set<string>();
      for (const face of g.faces) {
        for (let i = 0; i < face.length; i++) {
          const ia = face[i];
          const ib = face[(i + 1) % face.length];
          const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const va = g.vertices[ia];
          const vb = g.vertices[ib];
          if (va && vb) segs.push({ a: va, b: vb, thickness: 1 });
        }
      }
      return segs;
    }
    case "dimension":
      return [{ a: g.start, b: g.end, thickness: 0.8 }];
    case "text":
    default:
      return [];
  }
}

/**
 * Projeção ortográfica do documento (front/side/top) para primitivas PDF.
 * `colorFor` opcional permite sobrescrever a cor por elemento (diff com status).
 */
export function project(
  doc: ProjectDocument,
  view: "front" | "side" | "top",
  colorFor?: (el: GeometryElement) => RGB | undefined,
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
    const base = elLedPdf(el) ? NAVY : INK;
    const color = override ?? base;
    for (const seg of elementSegments(el)) {
      const a = map(seg.a.x, seg.a.y, seg.a.z);
      const b = map(seg.b.x, seg.b.y, seg.b.z);
      prims.push({ kind: "line", a, b, thickness: seg.thickness, color });
      grow(a, seg.thickness / 2);
      grow(b, seg.thickness / 2);
    }
  }
  if (!isFinite(bbox.min.x)) {
    bbox.min = { x: -1000, y: -1000 };
    bbox.max = { x: 1000, y: 1000 };
  }
  return { prims, bbox };
}

function elLedPdf(el: GeometryElement): boolean {
  return el.metadata?.led === true;
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
    const color = elLedPdf(el) ? NAVY : INK;
    for (const seg of elementSegments(el)) {
      const t = Math.max(1, Math.min(seg.thickness * 0.5, 30));
      const a = map(seg.a.x, seg.a.y, seg.a.z);
      const b = map(seg.b.x, seg.b.y, seg.b.z);
      prims.push({ kind: "line", a, b, thickness: t, color });
      grow(a, t);
      grow(b, t);
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
  const panel = panelDimsOf(doc);
  const panelLabel = panel ? `${panel.width} x ${panel.height} x ${panel.depth} mm · PD ${panel.ground_clearance} mm` : "não definido (geometria livre)";
  const rows: Array<[string, string]> = [
    ["PROJETO", sanitize(doc.project.name)],
    ["ID / REV", `${doc.project.id}  ·  REV ${String(revision).padStart(3, "0")}`],
    ["PAINEL", panelLabel],
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
  if (!check.ok || !check.doc) {
    throw new Error(`documento inválido para PDF: ${check.errors[0]?.message ?? "erro"}`);
  }
  const doc = check.doc; // normalizado v2 (v1 é convertido)
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
  const inst = installationOf(doc);
  const notes = [
    ...(inst ? [`Instalação: ${inst.type} · Ambiente: ${inst.environment}`] : []),
    ...doc.assumptions.slice(0, 6).map((a) => `- ${typeof a === "string" ? a : `${a.detail} (${a.path})`}`),
    "- Esboço derivado exclusivamente da geometria.",
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
  p2.drawText(sanitize("LISTA DE MATERIAIS (BOM) — derivada da geometria (opcional)"), { x: bx, y: byTop + 22, size: 13, font: bold, color: NAVY });
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
  p2.drawText(sanitize(`TOTAL ESTIMADO: ${bom.total_weight_kg.toFixed(1)} kg · ${bom.element_count} elementos${bom.partial ? " · BOM PARCIAL" : ""}`), {
    x: bx + 6,
    y: ry - 10,
    size: 10,
    font: bold,
    color: INK,
  });

  drawTitleBlock(p2, doc, revision, "2/2", bom.total_weight_kg, font, bold);

  return pdf.save();
}
