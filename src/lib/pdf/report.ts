/**
 * PDF — ESBOÇO GEOMÉTRICO COTADO (prancha técnica de referência).
 *
 * Princípios do produto:
 *  - O PDF mostra FORMA + DIMENSÕES + RELAÇÃO DE ENCAIXE. NÃO é documento de
 *    fabricação: sem BOM, peso, material, perfil estrutural, densidade ou lista
 *    de corte — isso é responsabilidade da empresa de estrutura e do engenheiro.
 *  - Vistas geradas dinamicamente conforme a geometria: frontal, lateral, planta,
 *    traseira (quando faz sentido), isométrica e detalhes por conjunto. O número
 *    de folhas varia conforme o que ajuda a entender aquela geometria.
 *  - Cotas: bounding box + cadeias de divisões (eixos de encontros/módulos),
 *    níveis de altura, afastamento do solo (PD), ângulos de inclinação e cotas
 *    explícitas (primitivo `dimension`).
 *  - Visual leve: linhas em tons de cinza, contornos um pouco mais fortes e
 *    superfícies com preenchimento cinza claro. Preto sólido evitado — inclusive
 *    em geometria livre (mesh/polygon), que permanece legível como desenho técnico.
 *  - Motor geométrico livre: qualquer primitivo v2 é desenhado; painel LED é só
 *    um uso (ganha apenas um tom azulado sutil de preenchimento).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, LineCapStyle, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import type { ProjectDocument, GeometryElement } from "@/lib/cad/schema";
import { panelDimsOf, installationOf, elLed, elGroup } from "@/lib/cad/schema";
import { validateProject } from "@/lib/cad/validation";

export const A2 = { w: 1683.78, h: 1190.55 }; // pt, landscape
export const MM = 72 / 25.4;

/* ============================ PALETA (visual leve) ============================ */

export const RED = rgb(0.78, 0.12, 0.12);
export const INK = rgb(0.16, 0.18, 0.21); // textos
export const GRAY = rgb(0.45, 0.49, 0.54);
export const LIGHT = rgb(0.75, 0.78, 0.82);
export const ORANGE = rgb(0.9, 0.45, 0.05);
export const NAVY = rgb(0.1, 0.15, 0.22);
export const GREEN = rgb(0.09, 0.64, 0.34);
export const PDF_RED = rgb(0.85, 0.15, 0.15);

// Geometria: tons de cinza (preto sólido evitado)
export const EDGE = rgb(0.24, 0.26, 0.3); // contornos de volumes (mais fortes)
export const LINE = rgb(0.46, 0.48, 0.53); // membros lineares (beams, linhas)
export const LINE_SOFT = rgb(0.62, 0.64, 0.68); // geometria de fundo / iso
export const FILL = rgb(0.945, 0.95, 0.955); // preenchimento de superfícies
export const FILL_LED = rgb(0.878, 0.906, 0.949); // painel/encaixe (azulado sutil)
export const EDGE_LED = rgb(0.52, 0.6, 0.72);
export const GHOST = rgb(0.76, 0.78, 0.81); // linhas de chamada, solo

export type RGB = ReturnType<typeof rgb>;

interface Pt {
  x: number;
  y: number;
}

/** Primitiva de desenho em coordenadas de VISTA (não de página). */
export interface Prim {
  kind: "line" | "poly" | "circle";
  a?: Pt;
  b?: Pt;
  pts?: Pt[];
  p?: Pt;
  r?: number;
  thickness: number; // em unidades do modelo (mm-ish)
  color?: RGB;
  fill?: RGB | null; // preenchimento para poly/circle
}

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
  /** true = aresta derivada de prisma (não vira nó de cadeia de cotas) */
  noNode?: boolean;
  /** true = traço interno leve (triangulação/diagonais) */
  light?: boolean;
}

const dist3 = (a: V3, b: V3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Componente Z do normal da face (Newell) — usado para tom por orientação. */
function faceNormalZ(pts: V3[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return nz / l;
}

/** Mistura duas cores (t = 0 → c1, 1 → c2). */
function mixRGB(c1: RGB, c2: RGB, t: number): RGB {
  const l = (a: number, b: number) => a + (b - a) * Math.max(0, Math.min(1, t));
  return rgb(l(c1.red, c2.red), l(c1.green, c2.green), l(c1.blue, c2.blue));
}

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

/* ===== MEMBROS COMO PRISMAS — beam/cylinder viram sólidos desenhados ===== */

type Prism = { ringA: V3[]; ringB: V3[]; round: boolean };

/** Anel de seção no ponto p, orientado pelo eixo a→b. */
function sectionRing(p: V3, axis: V3, u: V3, v: V3, hw: number, hh: number, round: boolean, sides: number): V3[] {
  const pts: V3[] = [];
  if (!round) {
    for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      pts.push({ x: p.x + u.x * hw * su + v.x * hh * sv, y: p.y + u.y * hw * su + v.y * hh * sv, z: p.z + u.z * hw * su + v.z * hh * sv });
    }
    return pts;
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const cu = Math.cos(a) * hw;
    const cv = Math.sin(a) * hh;
    pts.push({ x: p.x + u.x * cu + v.x * cv, y: p.y + u.y * cu + v.y * cv, z: p.z + u.z * cu + v.z * cv });
  }
  return pts;
}

/** Constrói o prisma (arestas + faces) de um membro beam/cylinder. */
function memberPrism(el: GeometryElement): Prism | null {
  const g = el.geometry;
  let a: V3;
  let b: V3;
  let round: boolean;
  let hw: number;
  let hh: number;
  if (g.type === "beam") {
    a = g.start;
    b = g.end;
    round = g.section.type === "round";
    hw = (round ? g.section.diameter : g.section.width) / 2;
    hh = (round ? g.section.diameter : g.section.height) / 2;
  } else if (g.type === "cylinder") {
    a = g.start;
    b = g.end;
    round = true;
    hw = g.diameter / 2;
    hh = hw;
  } else {
    return null;
  }
  if (!(hw > 0) || !(hh > 0)) return null;
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const az = b.z - a.z;
  const len = Math.hypot(ax, ay, az);
  if (len < 0.001) return null;
  const axis = { x: ax / len, y: ay / len, z: az / len };
  // base ortonormal ao eixo (ref = Z do modelo, evita eixo paralelo)
  const ref = Math.abs(axis.z) > 0.92 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  let ux = axis.y * ref.z - axis.z * ref.y;
  let uy = axis.z * ref.x - axis.x * ref.z;
  let uz = axis.x * ref.y - axis.y * ref.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const u = { x: ux, y: uy, z: uz };
  const v = { x: axis.y * u.z - axis.z * u.y, y: axis.z * u.x - axis.x * u.z, z: axis.x * u.y - axis.y * u.x };
  const sides = round ? 8 : 4;
  const ringA = sectionRing(a, axis, u, v, hw, hh, round, sides);
  const ringB = sectionRing(b, axis, u, v, hw, hh, round, sides);
  return { ringA, ringB, round };
}

/** Arestas do prisma do membro (anel A, anel B e longitudinais) — sem nós de cadeia. */
function prismSegments(p: Prism, thickness = 1): Seg3[] {
  const segs: Seg3[] = [];
  const n = p.ringA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segs.push({ a: p.ringA[i], b: p.ringA[j], thickness, noNode: true });
    segs.push({ a: p.ringB[i], b: p.ringB[j], thickness, noNode: true });
    segs.push({ a: p.ringA[i], b: p.ringB[i], thickness, noNode: true });
  }
  return segs;
}

/** Faces do prisma do membro (laterais + tampas). */
function prismFaces(p: Prism): V3[][] {
  const faces: V3[][] = [];
  const n = p.ringA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([p.ringA[i], p.ringA[j], p.ringB[j], p.ringB[i]]);
  }
  faces.push([...p.ringA]);
  faces.push([...p.ringB].reverse());
  return faces;
}
/** faces do box (índices dos corners) */
const BOX_FACES: Array<[number, number, number, number]> = [
  [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
];

function planePoint(plane: string, c: V3, r: number, angleRad: number): V3 {
  if (plane === "XY") return { x: c.x + r * Math.cos(angleRad), y: c.y + r * Math.sin(angleRad), z: c.z };
  if (plane === "YZ") return { x: c.x, y: c.y + r * Math.cos(angleRad), z: c.z + r * Math.sin(angleRad) };
  return { x: c.x + r * Math.cos(angleRad), y: c.y, z: c.z + r * Math.sin(angleRad) };
}

/** Converte QUALQUER primitivo em segmentos 3D — o PDF deriva da geometria, ponto final. */
export function elementSegments(el: GeometryElement): Seg3[] {
  const g = el.geometry;
  switch (g.type) {
    case "line":
      return [{ a: g.start, b: g.end, thickness: Math.max(g.thickness ?? 8, 1) }];
    case "beam":
    case "cylinder": {
      // membro desenhado como PRISMA (arestas de volume reais) — desenho completo
      const p = memberPrism(el);
      if (p) return prismSegments(p);
      return [{ a: g.start, b: g.end, thickness: 1 }];
    }
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
      // diagonais da triangulação em leque — traços internos leves
      for (let i = 2; i < pts.length - 1; i++) {
        segs.push({ a: pts[0], b: pts[i], thickness: 0.6, noNode: true, light: true });
      }
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
      // diagonais das faces (leque) — traços internos leves, com teto
      let lightCount = 0;
      for (const face of g.faces) {
        if (face.length < 4) continue;
        for (let i = 2; i < face.length - 1; i++) {
          if (lightCount++ > 3000) return segs;
          const va = g.vertices[face[0]];
          const vb = g.vertices[face[i]];
          if (va && vb) segs.push({ a: va, b: vb, thickness: 0.6, noNode: true, light: true });
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

/** Faces fechadas (polígonos 3D) para preenchimento cinza claro — volumes e superfícies. */
function elementFaces(el: GeometryElement): { pts: V3[]; led: boolean }[] {
  const g = el.geometry;
  const led = elLed(el);
  switch (g.type) {
    case "box": {
      const corners = boxCorners(g.center, g.size, g.rotation);
      return BOX_FACES.map((f) => ({ pts: f.map((i) => corners[i]), led }));
    }
    case "beam":
    case "cylinder": {
      // faces do prisma do membro → membros desenhados como sólidos claros
      const p = memberPrism(el);
      return p ? prismFaces(p).map((pts) => ({ pts, led })) : [];
    }
    case "polygon":
    case "surface":
      return [{ pts: g.points, led }];
    case "mesh": {
      // escape universal: mantém legível (arestas), sem virar massa — cap de faces
      if (g.faces.length > 256) return [];
      return g.faces
        .map((f) => ({ pts: f.map((i) => g.vertices[i]).filter(Boolean), led }))
        .filter((f) => f.pts.length >= 3);
    }
    default:
      return [];
  }
}

/** Textos 3D do documento (primitivo `text`). */
function elementTexts(el: GeometryElement): { p: V3; text: string; height: number }[] {
  if (el.geometry.type !== "text") return [];
  return [{ p: el.geometry.position, text: el.geometry.text, height: el.geometry.height ?? 100 }];
}

/** Cotas explícitas do documento (primitivo `dimension`). */
function elementDims(el: GeometryElement): { a: V3; b: V3; label: string }[] {
  if (el.geometry.type !== "dimension") return [];
  return [{ a: el.geometry.start, b: el.geometry.end, label: el.geometry.text ?? "" }];
}

/* ============================ PROJEÇÃO ============================ */

export type ViewName = "front" | "back" | "side" | "top" | "iso";

export interface ProjEl {
  id: string;
  group: string;
  led: boolean;
  /** depth = chave de tom na iso (perto = mais escuro); light = traço interno leve */
  segs: Array<{ a: Pt; b: Pt; thickness: number; edge: boolean; depth?: number; light?: boolean }>; // edge = aresta de volume
  /** face projetada; depth = ordenação na iso; tone = escurecimento por orientação (0..0.2) */
  faces: Array<{ pts: Pt[]; depth: number; tone: number }>;
  texts: Array<{ p: Pt; text: string; height: number }>;
  dims: Array<{ a: Pt; b: Pt; label: string }>;
}

export interface Projection {
  els: ProjEl[];
  bbox: { min: Pt; max: Pt };
  view: ViewName;
  /** posições (coord. de vista) para cadeias de cotas: eixos de encontro/divisões */
  chainX: number[];
  chainY: number[];
  /** segmentos inclinados relevantes (para marcação de ângulo) */
  angles: Array<{ a: Pt; b: Pt }>;
  /** faixa de profundidade (iso) para tonalidade dos traços */
  depthRange: [number, number];
}

function emptyBBox2() {
  return { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
}

function mapView(view: ViewName): (x: number, y: number, z: number) => Pt {
  if (view === "front") return (x, _y, z) => ({ x, y: z });
  if (view === "back") return (x, _y, z) => ({ x: -x, y: z });
  if (view === "side") return (_x, y, z) => ({ x: y, y: z });
  if (view === "top") return (x, y, _z) => ({ x, y });
  return (x, y, z) => ({ x: (x - y) * Math.cos(Math.PI / 6), y: z + (x + y) * Math.sin(Math.PI / 6) * 0.35 });
}

function growPt(bbox: ReturnType<typeof emptyBBox2>, p: Pt, pad = 0): void {
  bbox.min.x = Math.min(bbox.min.x, p.x - pad);
  bbox.min.y = Math.min(bbox.min.y, p.y - pad);
  bbox.max.x = Math.max(bbox.max.x, p.x + pad);
  bbox.max.y = Math.max(bbox.max.y, p.y + pad);
}

/** Agrupa valores próximos (mm) — tolerância proporcional à extensão. */
function clusterPositions(values: number[], span: number): number[] {
  const tol = Math.max(3, span * 0.006);
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v);
    else out[out.length - 1] = (out[out.length - 1] + v) / 2;
  }
  return out;
}

/**
 * Projeção ortográfica/isométrica do documento, por elemento.
 * Também deriva as cadeias de cotas (eixos verticais → divisões em X;
 * níveis horizontais → alturas) e os segmentos inclinados (ângulos).
 */
export function projectView(doc: ProjectDocument, view: ViewName): Projection {
  const map = mapView(view);
  const bbox = emptyBBox2();
  const els: ProjEl[] = [];
  let depthMin = Infinity;
  let depthMax = -Infinity;
  const verticalXs: number[] = [];
  const horizontalYs: number[] = [];
  const angleCands: Array<{ a: Pt; b: Pt; len: number }> = [];
  const iso = view === "iso";

  for (const el of doc.elements) {
    const pe: ProjEl = { id: el.id, group: elGroup(el), led: elLed(el), segs: [], faces: [], texts: [], dims: [] };

    // faces (preenchimento cinza claro) — ortográficas exatas; iso ordenada por profundidade;
    // TOM por orientação da face: topo um pouco mais escuro, fundo mais ainda (leitura de plano)
    for (const f of elementFaces(el)) {
      const poly = f.pts.map((p) => map(p.x, p.y, p.z));
      if (poly.length < 3) continue;
      const depth = iso ? f.pts.reduce((acc, p) => acc + p.x - p.y + p.z * 0.3, 0) / f.pts.length : 0;
      const nz = faceNormalZ(f.pts);
      const tone = nz > 0.5 ? 0.1 : nz < -0.5 ? 0.18 : 0;
      pe.faces.push({ pts: poly, depth, tone });
      for (const p of poly) growPt(bbox, p);
    }

    // nós de cadeia pelo EIXO do membro (as arestas do prisma têm noNode e não entram)
    const gt = el.geometry.type;
    if (!iso && (gt === "beam" || gt === "cylinder")) {
      const gs = el.geometry as { start: V3; end: V3 };
      const A0 = map(gs.start.x, gs.start.y, gs.start.z);
      const B0 = map(gs.end.x, gs.end.y, gs.end.z);
      const dx0 = Math.abs(B0.x - A0.x);
      const dy0 = Math.abs(B0.y - A0.y);
      if (Math.hypot(dx0, dy0) > 60) {
        if (dy0 > dx0 * 2) verticalXs.push(A0.x, B0.x);
        else if (dx0 > dy0 * 2) horizontalYs.push(A0.y, B0.y);
      }
    }

    for (const s of elementSegments(el)) {
      const A = map(s.a.x, s.a.y, s.a.z);
      const B = map(s.b.x, s.b.y, s.b.z);
      const edge = s.thickness <= 2.5; // arestas de volumes/contornos são finas
      const depth = iso ? (s.a.x - s.a.y + s.a.z * 0.3 + s.b.x - s.b.y + s.b.z * 0.3) / 2 : undefined;
      if (iso) {
        depthMin = Math.min(depthMin, depth!);
        depthMax = Math.max(depthMax, depth!);
      }
      pe.segs.push({ a: A, b: B, thickness: iso ? Math.max(1, Math.min(s.thickness * 0.5, 30)) : s.thickness, edge, depth });
      growPt(bbox, A);
      growPt(bbox, B);

      if (iso || s.noNode) continue;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy);
      // eixos verticais (postes/montantes/bordas de gabinete) → cadeia em X
      if (Math.abs(dy) > Math.abs(dx) * 2 && len > 60) verticalXs.push(A.x, B.x);
      // níveis horizontais (vigas, bordas de módulos) → cadeia em Y
      if (Math.abs(dx) > Math.abs(dy) * 2 && len > 60) horizontalYs.push(A.y, B.y);
      // inclinados → marcação de ângulo
      if (len > 150 && Math.abs(dx) > 1 && Math.abs(dy) > 1) {
        const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
        if (ang >= 8 && ang <= 82) angleCands.push({ a: A, b: B, len });
      }
    }

    for (const t of elementTexts(el)) {
      const p = map(t.p.x, t.p.y, t.p.z);
      pe.texts.push({ p, text: t.text, height: t.height });
      growPt(bbox, p);
    }
    for (const d of elementDims(el)) {
      const A = map(d.a.x, d.a.y, d.a.z);
      const B = map(d.b.x, d.b.y, d.b.z);
      pe.dims.push({ a: A, b: B, label: d.label || `${Math.round(dist3(d.a, d.b))}` });
      growPt(bbox, A);
      growPt(bbox, B);
    }

    els.push(pe);
  }

  if (!isFinite(bbox.min.x)) {
    bbox.min = { x: 0, y: 0 };
    bbox.max = { x: 1000, y: 1000 };
  }
  const spanX = Math.max(1, bbox.max.x - bbox.min.x);
  const spanY = Math.max(1, bbox.max.y - bbox.min.y);

  const chainX = clusterPositions(verticalXs, spanX);
  const chainY = clusterPositions(horizontalYs, spanY);
  // cadeias só ajudam quando há de fato divisões (≥3 eixos) e não ficam densas demais
  const chainXok = chainX.length >= 3 && chainX.length <= 14 ? chainX : [];
  const chainYok = chainY.length >= 3 && chainY.length <= 14 ? chainY : [];
  angleCands.sort((p, q) => q.len - p.len);

  return {
    els,
    bbox,
    view,
    chainX: chainXok,
    chainY: chainYok,
    depthRange: [isFinite(depthMin) ? depthMin : 0, isFinite(depthMax) ? depthMax : 1],
    angles: iso ? [] : angleCands.slice(0, 6).map(({ a, b }) => ({ a, b })),
  };
}

/** Impressão digital geométrica — decide se a vista traseira agrega algo. */
function fingerprint(p: Projection): string {
  const parts: string[] = [];
  for (const el of p.els) {
    for (const s of el.segs) parts.push(`${r1(s.a.x)},${r1(s.a.y)}|${r1(s.b.x)},${r1(s.b.y)}`);
  }
  parts.sort();
  return parts.join(";");
}

/* ==================== DESENHO (página) ==================== */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TF {
  scale: number; // pt de página por mm de modelo
  toPage: (p: Pt) => Pt;
  bbox: Projection["bbox"];
  box: ViewBox;
}

function isAxisRect(pts: Pt[], tol = 0.6): { x: number; y: number; w: number; h: number } | null {
  if (pts.length !== 4) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  for (const p of pts) {
    if (Math.abs(p.x - minX) > tol && Math.abs(p.x - maxX) > tol) return null;
    if (Math.abs(p.y - minY) > tol && Math.abs(p.y - maxY) > tol) return null;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Preenche polígono (cinza claro) com contorno sutil; atalho nativo p/ retângulos. */
function drawPolyFill(page: PDFPage, pts: Pt[], fill: RGB, border: RGB, opacity = 0.9): void {
  const rect = isAxisRect(pts);
  if (rect) {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      color: fill,
      opacity,
      borderColor: border,
      borderWidth: 0.6,
      borderOpacity: 0.85,
    });
    return;
  }
  // caminho SVG: pdf-lib aplica y invertido (página = (x + sx, y - sy)); origem (0,0)
  const d = "M " + pts.map((p) => `${r1(p.x)} ${r1(-p.y)}`).join(" L ") + " Z";
  page.drawSvgPath(d, {
    x: 0,
    y: 0,
    color: fill,
    opacity,
    borderColor: border,
    borderWidth: 0.6,
    borderOpacity: 0.85,
  });
}

export interface DrawProjOpts {
  /** sobrescreve a cor de linha por elemento (diff) */
  colorFor?: (el: ProjEl) => RGB | undefined;
  /** sobrescreve o preenchimento por elemento (diff); null = sem preenchimento */
  fillFor?: (el: ProjEl) => RGB | null | undefined;
  labelSize?: number;
  pad?: number;
  /** desenha cotas explícitas e textos do documento dentro da vista */
  docAnnotations?: boolean;
  scaleNote?: { value: number };
}

/**
 * Desenha uma projeção dentro de uma caixa da página: preenchimentos primeiro
 * (cinza claro), depois contornos/membros, textos e cotas explícitas.
 * Retorna a transformação (escala + toPage) para cotagem externa.
 */
export function drawProjection(
  page: PDFPage,
  proj: Projection,
  box: ViewBox,
  font: PDFFont,
  label: string,
  opts: DrawProjOpts = {},
): TF {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: LIGHT, borderWidth: 1 });
  const pad = opts.pad ?? 30;
  // IMPORTANTE: no PDF o eixo Y cresce PARA CIMA. Mapear o y do modelo direto para
  // o y da página (sem inverter) mantém o Z do modelo apontando para o alto da folha.
  // Quando há afastamento do solo (bbox.min.y > 0), o solo (y=0) entra no enquadramento
  // para a linha de solo e a cota PD ficarem dentro do quadro da vista.
  const effMinY = proj.view !== "top" && proj.bbox.min.y > 20 ? 0 : proj.bbox.min.y;
  const bw = Math.max(1, proj.bbox.max.x - proj.bbox.min.x);
  const bh = Math.max(1, proj.bbox.max.y - effMinY);
  const scale = Math.min((box.w - pad * 2) / bw, (box.h - pad * 2) / bh);
  if (opts.scaleNote) opts.scaleNote.value = scale;
  const toPage = (p: Pt): Pt => ({
    x: box.x + pad + (p.x - proj.bbox.min.x) * scale,
    y: box.y + pad + (p.y - effMinY) * scale,
  });
  const iso = proj.view === "iso";
  const FILL_DARK = rgb(0.72, 0.75, 0.78); // tom de sombreado por orientação de face
  let fillBudget = 4000; // teto de polígonos preenchidos por vista (desempenho)

  // 1) preenchimentos (fundo) — iso ordena por profundidade (menor = mais longe)
  const fillJobs: Array<{ el: ProjEl; face: { pts: Pt[]; depth: number; tone: number } }> = [];
  for (const el of proj.els) {
    for (const face of el.faces) fillJobs.push({ el, face });
  }
  if (iso) fillJobs.sort((a, b) => a.face.depth - b.face.depth);
  for (const { el, face } of fillJobs) {
    if (fillBudget-- <= 0) break;
    const override = opts.fillFor?.(el);
    const fill = override === undefined ? (el.led ? FILL_LED : FILL) : override;
    if (fill === null) continue;
    const border = el.led ? EDGE_LED : LINE_SOFT;
    // sombreado por orientação: topo/fundo da face ganham tom distinto → leitura de plano
    const fill2 = face.tone > 0 ? mixRGB(fill, FILL_DARK, face.tone) : fill;
    drawPolyFill(page, face.pts.map(toPage), fill2, border, iso ? 0.8 : 0.9);
  }

  // 2) linhas — contornos (EDGE) e membros (LINE); na ISO o traço ganha TOM POR PROFUNDIDADE
  // (perto = mais escuro/forte, longe = mais claro/leve) — sensação de croqui de perspectiva
  const [dmin, dmax] = proj.depthRange;
  for (const el of proj.els) {
    const override = opts.colorFor?.(el);
    for (const s of el.segs) {
      const t = Math.max(0.55, Math.min(s.thickness * scale, 2.4));
      let color: RGB = override ?? (iso ? LINE_SOFT : s.edge ? EDGE : LINE);
      let thickness = iso ? Math.max(0.55, Math.min(t, 1.4)) : t;
      if (iso && s.depth !== undefined && dmax > dmin) {
        const tone = Math.max(0, Math.min(1, (s.depth - dmin) / (dmax - dmin))); // 0 = longe, 1 = perto
        color = override ?? rgb(0.62 - 0.3 * tone, 0.64 - 0.3 * tone, 0.68 - 0.3 * tone);
        thickness = Math.max(0.55, Math.min(t * (0.75 + 0.55 * tone), 1.7));
      }
      if (s.light && !override) {
        // traços internos (triangulação/diagonais) — bem leves
        page.drawLine({
          start: toPage(s.a),
          end: toPage(s.b),
          thickness: Math.max(0.4, thickness * 0.5),
          color: LINE_SOFT,
          lineCap: LineCapStyle.Round,
        });
        continue;
      }
      page.drawLine({
        start: toPage(s.a),
        end: toPage(s.b),
        thickness,
        color,
        lineCap: LineCapStyle.Round,
      });
    }
  }

  // 3) textos do documento
  if (opts.docAnnotations !== false) {
    for (const el of proj.els) {
      for (const t of el.texts) {
        const size = Math.max(4, Math.min(t.height * scale * 0.72, 13));
        const p = toPage(t.p);
        page.drawText(sanitize(t.text).slice(0, 60), { x: p.x, y: p.y, size, font, color: EDGE });
      }
      // 4) cotas explícitas (primitivo dimension)
      for (const d of el.dims) {
        drawExplicitDim(page, toPage(d.a), toPage(d.b), d.label, font);
      }
    }
  }

  // rótulo da vista + escala aproximada
  page.drawText(sanitize(label), {
    x: box.x + 10,
    y: box.y + box.h - (opts.labelSize ?? 13) - 6,
    size: opts.labelSize ?? 13,
    font,
    color: NAVY,
  });
  const ratio = MM / scale;
  if (ratio >= 0.8 && ratio <= 500) {
    page.drawText(`ESC ~1:${Math.round(ratio)}`, {
      x: box.x + box.w - 78,
      y: box.y + 8,
      size: 8,
      font,
      color: GRAY,
    });
  }

  return { scale, toPage, bbox: proj.bbox, box };
}

/* ==================== COTAS ==================== */

function tick(page: PDFPage, p: Pt, horizontal: boolean, color: RGB, tick = 5): void {
  if (horizontal) {
    page.drawLine({ start: { x: p.x, y: p.y - tick }, end: { x: p.x, y: p.y + tick }, thickness: 0.9, color });
  } else {
    page.drawLine({ start: { x: p.x - tick, y: p.y }, end: { x: p.x + tick, y: p.y }, thickness: 0.9, color });
  }
}

function dimLabel(page: PDFPage, p: Pt, text: string, font: PDFFont, size = 8.5, color: RGB = ORANGE): void {
  const w = (font.widthOfTextAtSize(text, size) * 11) / 10;
  page.drawRectangle({ x: p.x - w / 2 - 2.5, y: p.y - size / 2 - 1, width: w + 5, height: size + 2.5, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawText(text, { x: p.x - w / 2, y: p.y - size / 2 + 1, size, font, color });
}

/** Cota explícita (primitivo dimension): linha + ticks + rótulo da medida. */
function drawExplicitDim(page: PDFPage, a: Pt, b: Pt, label: string, font: PDFFont): void {
  page.drawLine({ start: a, end: b, thickness: 0.9, color: ORANGE });
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  tick(page, a, horizontal, ORANGE);
  tick(page, b, horizontal, ORANGE);
  dimLabel(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 3 }, `${label} mm`, font, 7.5);
}

/** Cadeia horizontal de cotas (divisões em X) abaixo da vista. */
function drawChainH(page: PDFPage, tf: TF, xs: number[], offset: number, font: PDFFont, labelSize = 8.5): void {
  if (xs.length < 2) return;
  const yBase = tf.toPage({ x: tf.bbox.min.x, y: tf.bbox.min.y }).y;
  const yDim = yBase - offset;
  for (const x of xs) {
    const px = tf.toPage({ x, y: tf.bbox.min.y }).x;
    page.drawLine({ start: { x: px, y: yBase + 4 }, end: { x: px, y: yDim - 5 }, thickness: 0.5, color: GHOST });
    tick(page, { x: px, y: yDim }, true, ORANGE, 4.5);
  }
  page.drawLine({ start: { x: tf.toPage({ x: xs[0], y: 0 }).x, y: yDim }, end: { x: tf.toPage({ x: xs[xs.length - 1], y: 0 }).x, y: yDim }, thickness: 0.8, color: ORANGE });
  for (let i = 1; i < xs.length; i++) {
    const a = tf.toPage({ x: xs[i - 1], y: 0 }).x;
    const b = tf.toPage({ x: xs[i], y: 0 }).x;
    if (b - a < 20) continue; // segmento curto demais para rótulo
    dimLabel(page, { x: (a + b) / 2, y: yDim }, `${Math.round(xs[i] - xs[i - 1])}`, font, labelSize);
  }
}

/** Cadeia vertical de cotas (níveis de altura) à esquerda da vista. */
function drawChainV(page: PDFPage, tf: TF, ys: number[], offset: number, font: PDFFont, labelSize = 8.5): void {
  if (ys.length < 2) return;
  const xBase = tf.toPage({ x: tf.bbox.min.x, y: tf.bbox.min.y }).x;
  const xDim = xBase - offset;
  for (const y of ys) {
    const py = tf.toPage({ x: tf.bbox.min.x, y }).y;
    page.drawLine({ start: { x: xBase - 4, y: py }, end: { x: xDim + 5, y: py }, thickness: 0.5, color: GHOST });
    tick(page, { x: xDim, y: py }, false, ORANGE, 4.5);
  }
  const top = tf.toPage({ x: 0, y: ys[ys.length - 1] }).y;
  const bottom = tf.toPage({ x: 0, y: ys[0] }).y;
  page.drawLine({ start: { x: xDim, y: top }, end: { x: xDim, y: bottom }, thickness: 0.8, color: ORANGE });
  for (let i = 1; i < ys.length; i++) {
    const a = tf.toPage({ x: 0, y: ys[i] }).y;
    const b = tf.toPage({ x: 0, y: ys[i - 1] }).y;
    if (b - a < 18) continue;
    dimLabel(page, { x: xDim, y: (a + b) / 2 + 3 }, `${Math.round(ys[i] - ys[i - 1])}`, font, labelSize);
  }
}

/** Cota "overall" horizontal (largura total da vista). */
function drawOverallH(page: PDFPage, tf: TF, offset: number, font: PDFFont, labelSize = 9.5): void {
  const { min, max } = tf.bbox;
  const a = tf.toPage({ x: min.x, y: min.y });
  const b = tf.toPage({ x: max.x, y: min.y });
  const y = a.y - offset;
  page.drawLine({ start: { x: a.x, y }, end: { x: b.x, y }, thickness: 1, color: ORANGE });
  tick(page, { x: a.x, y }, true, ORANGE);
  tick(page, { x: b.x, y }, true, ORANGE);
  dimLabel(page, { x: (a.x + b.x) / 2, y }, `${Math.round(max.x - min.x)} mm`, font, labelSize);
}

/** Cota "overall" vertical (altura total da vista). */
function drawOverallV(page: PDFPage, tf: TF, offset: number, side: "left" | "right", font: PDFFont, labelSize = 9.5): void {
  const { min, max } = tf.bbox;
  const a = tf.toPage({ x: side === "left" ? min.x : max.x, y: min.y });
  const b = tf.toPage({ x: side === "left" ? min.x : max.x, y: max.y });
  const x = a.x + (side === "left" ? -offset : offset);
  page.drawLine({ start: { x, y: a.y }, end: { x, y: b.y }, thickness: 1, color: ORANGE });
  tick(page, { x, y: a.y }, false, ORANGE);
  tick(page, { x, y: b.y }, false, ORANGE);
  const w = font.widthOfTextAtSize(`${Math.round(max.y - min.y)} mm`, labelSize);
  page.drawRectangle({ x: x - w / 2 - 2.5, y: (a.y + b.y) / 2 - labelSize / 2 - 1, width: w + 5, height: labelSize + 2.5, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawText(`${Math.round(max.y - min.y)} mm`, { x: x - w / 2, y: (a.y + b.y) / 2 - labelSize / 2 + 1, size: labelSize, font, color: ORANGE });
}

/** Linha do solo (±0) quando a geometria está afastada do chão (dentro da caixa da vista). */
function drawGroundLine(page: PDFPage, tf: TF, font: PDFFont): void {
  if (tf.bbox.min.y <= 20) return;
  const y = tf.toPage({ x: 0, y: 0 }).y;
  if (y < tf.box.y + 12) return; // solo não cabe na caixa — evita cruzar outras vistas
  const x0 = Math.max(tf.box.x + 6, tf.toPage({ x: tf.bbox.min.x, y: 0 }).x - 30);
  const x1 = Math.min(tf.box.x + tf.box.w - 6, tf.toPage({ x: tf.bbox.max.x, y: 0 }).x + 30);
  page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 1.2, color: LINE_SOFT });
  // hachura clássica de solo (traços a 45° abaixo da linha)
  for (let hx = x0 + 4; hx <= x1; hx += 14) {
    page.drawLine({ start: { x: hx, y }, end: { x: hx - 6, y: y - 6 }, thickness: 0.5, color: GHOST });
  }
  // rótulo à direita da linha, dentro da página (a linha de solo só é desenhada na vista frontal)
  if (x1 + 55 < A2.w - 8) {
    page.drawText("SOLO +/-0", { x: x1 + 4, y: y - 3, size: 7.5, font, color: GRAY });
  }
}

/** Afastamento do solo (PD) — cota vertical à direita, do solo até o elemento mais baixo. */
function drawGroundClearance(page: PDFPage, tf: TF, offset: number, font: PDFFont): void {
  const pd = tf.bbox.min.y;
  if (pd <= 20) return;
  const y0 = tf.toPage({ x: tf.bbox.max.x, y: 0 }).y;
  if (y0 < tf.box.y + 26) return; // sem espaço para o solo dentro da caixa
  const a = tf.toPage({ x: tf.bbox.max.x, y: 0 });
  const b = tf.toPage({ x: tf.bbox.max.x, y: pd });
  const x = Math.min(a.x + offset, tf.box.x + tf.box.w - 12);
  page.drawLine({ start: { x, y: a.y }, end: { x, y: b.y }, thickness: 0.9, color: ORANGE });
  tick(page, { x, y: a.y }, false, ORANGE, 4.5);
  tick(page, { x, y: b.y }, false, ORANGE, 4.5);
  const label = `PD ${Math.round(pd)}`;
  const w = font.widthOfTextAtSize(label, 8.5);
  page.drawRectangle({ x: x - w / 2 - 2.5, y: (a.y + b.y) / 2 - 5, width: w + 5, height: 12, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawText(label, { x: x - w / 2, y: (a.y + b.y) / 2 - 3, size: 8.5, font, color: ORANGE });
}

/** Rótulos de conjunto sobre a vista (nome no topo do bbox do grupo) — cara de desenho completo. */
function drawGroupLabels(page: PDFPage, proj: Projection, tf: TF, font: PDFFont): void {
  const byGroup = new Map<string, { minX: number; maxX: number; maxY: number }>();
  for (const el of proj.els) {
    const cur = byGroup.get(el.group) ?? { minX: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of el.segs) {
      cur.minX = Math.min(cur.minX, s.a.x, s.b.x);
      cur.maxX = Math.max(cur.maxX, s.a.x, s.b.x);
      cur.maxY = Math.max(cur.maxY, s.a.y, s.b.y);
    }
    byGroup.set(el.group, cur);
  }
  const items = [...byGroup.entries()].filter(([g]) => g !== "GERAL").slice(0, 10);
  for (const [name, v] of items) {
    const cx = tf.toPage({ x: (v.minX + v.maxX) / 2, y: 0 }).x;
    const py = tf.toPage({ x: 0, y: v.maxY }).y + 5;
    if (py < tf.box.y + 6 || py > tf.box.y + tf.box.h - 26) continue;
    const text = sanitize(name.toUpperCase()).slice(0, 26);
    const w = font.widthOfTextAtSize(text, 7);
    page.drawRectangle({ x: cx - w / 2 - 3, y: py - 2, width: w + 6, height: 10, color: rgb(1, 1, 1), opacity: 0.85 });
    page.drawText(text, { x: cx - w / 2, y: py, size: 7, font, color: GRAY });
  }
}

/** Marcação de ângulo de segmentos inclinados (arco + rótulo em graus). */
function drawAngleMark(page: PDFPage, a: Pt, b: Pt, font: PDFFont, radius = 30): void {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const segLen = Math.hypot(vx, vy);
  if (segLen < 1) return;
  const angDeg = (Math.atan2(Math.abs(vy), Math.abs(vx)) * 180) / Math.PI;
  if (angDeg < 8 || angDeg > 82) return;
  const sign = vx >= 0 ? 1 : -1;
  const ref = { x: a.x + sign * radius, y: a.y };
  page.drawLine({ start: a, end: ref, thickness: 0.6, color: GRAY });
  const dir = { x: vx / segLen, y: vy / segLen };
  // arco aproximado do referencial horizontal até a direção do segmento
  const steps = 8;
  let prev = ref;
  for (let i = 1; i <= steps; i++) {
    const t = (angDeg * i) / steps;
    const rad = (t * Math.PI) / 180;
    const p = { x: a.x + sign * radius * Math.cos(rad), y: a.y + radius * Math.sin(rad) };
    page.drawLine({ start: prev, end: p, thickness: 0.6, color: GRAY });
    prev = p;
  }
  const mid = (angDeg / 2) * (Math.PI / 180);
  dimLabel(page, { x: a.x + sign * (radius + 16) * Math.cos(mid), y: a.y + (radius + 14) * Math.sin(mid) }, `${Math.round(angDeg)}°`, font, 8);
}

/* ==================== CROMO DA PRANCHA ==================== */

function drawBanner(page: PDFPage, font: PDFFont, bold: PDFFont, sheetTitle: string): void {
  page.drawRectangle({ x: 0, y: A2.h - 40, width: A2.w, height: 40, color: rgb(0.985, 0.965, 0.955) });
  page.drawText(
    sanitize(
      "ESBOÇO GEOMÉTRICO COTADO — SEM DEFINIÇÃO DE MATERIAL, PERFIL OU FABRICAÇÃO · DIMENSIONAMENTO ESTRUTURAL E EXECUÇÃO SOB RESPONSABILIDADE DE PROFISSIONAL HABILITADO.",
    ),
    { x: 24, y: A2.h - 27, size: 10.5, font: bold, color: RED },
  );
  page.drawText(sanitize(sheetTitle), { x: A2.w - 24 - font.widthOfTextAtSize(sanitize(sheetTitle), 12), y: A2.h - 27, size: 12, font: bold, color: NAVY });
  page.drawText(sanitize("LED Collor CAD · esboço de referência geométrica"), { x: 24, y: 12, size: 8.5, font, color: GRAY });
}

function drawTitleBlock(
  page: PDFPage,
  doc: ProjectDocument,
  revision: number,
  sheet: string,
  font: PDFFont,
  bold: PDFFont,
  logo: PDFImage | null,
): void {
  const w = 460;
  const h = 150;
  const x = A2.w - w - 24;
  const y = 24;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: NAVY, borderWidth: 1.5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y: y + h - 34, width: w, height: 34, color: NAVY });
  let subtitleX = x + 140;
  if (logo) {
    // chip branco + logo institucional no cabeçalho do quadro
    const lh = 22;
    const lw = lh * (logo.width / logo.height);
    page.drawRectangle({ x: x + 8, y: y + h - 30, width: lw + 12, height: 26, color: rgb(1, 1, 1) });
    page.drawImage(logo, { x: x + 14, y: y + h - 28, width: lw, height: lh });
    subtitleX = x + 14 + lw + 16;
  } else {
    page.drawText("LED COLLOR", { x: x + 12, y: y + h - 25, size: 18, font: bold, color: rgb(1, 1, 1) });
  }
  page.drawText(sanitize("ESBOÇO GEOMÉTRICO COTADO"), { x: subtitleX, y: y + h - 22, size: 10, font, color: rgb(0.85, 0.87, 0.9) });

  const groups = new Set(doc.elements.map((el) => elGroup(el)));
  const panel = panelDimsOf(doc);
  const rows: Array<[string, string]> = [
    ["PROJETO", sanitize(doc.project.name)],
    ["ID / REV", `${doc.project.id}  ·  REV ${String(revision).padStart(3, "0")}`],
    ["GEOMETRIA", `${doc.elements.length} elementos · ${groups.size} conjunto(s) · unidade mm`],
    ["DATA / FOLHA", `${new Date().toLocaleDateString("pt-BR")}  ·  ${sheet}`],
  ];
  if (panel) {
    rows.push(["REF. ENCAIXE", `painel ${panel.width} x ${panel.height} x ${panel.depth} mm · PD ${panel.ground_clearance} mm`]);
  }
  let ry = y + h - 52;
  for (const [k, v] of rows) {
    page.drawText(sanitize(k), { x: x + 12, y: ry, size: 8, font: bold, color: GRAY });
    page.drawText(sanitize(v).slice(0, 66), { x: x + 112, y: ry, size: 10, font, color: INK });
    ry -= 20;
  }
  page.drawText(
    sanitize("AVISO: FORMA + DIMENSÕES + ENCAIXE — material, fabricação e resistência: responsabilidade de engenheiro habilitado."),
    { x: x + 12, y: y + 6, size: 7.5, font: bold, color: RED },
  );
}

/** Notas + legenda de linhas (rodapé esquerdo da folha 1). */
function drawNotes(page: PDFPage, doc: ProjectDocument, x: number, yTop: number, w: number, font: PDFFont, bold: PDFFont): void {
  page.drawText(sanitize("NOTAS E REFERÊNCIAS"), { x, y: yTop, size: 12, font: bold, color: NAVY });
  const inst = installationOf(doc);
  const panel = panelDimsOf(doc);
  const notes: string[] = [
    "Unidade: milímetros (mm) · Eixos: X largura · Y profundidade · Z altura · solo = Z 0.",
    "Cadeias de cotas indicam eixos de encontro/divisão (postes, módulos, articulações).",
  ];
  if (panel) notes.push(`Encaixe do painel (ref.): ${panel.width} x ${panel.height} x ${panel.depth} mm · PD ${panel.ground_clearance} mm.`);
  if (inst) notes.push(`Instalação: ${inst.type} · ambiente: ${inst.environment}.`);
  for (const a of doc.assumptions.slice(0, 4)) notes.push(`- ${typeof a === "string" ? a : `${a.detail} (${a.path})`}`);
  notes.push("Esboço derivado exclusivamente da geometria do documento.");
  let ry = yTop - 20;
  for (const n of notes) {
    page.drawText(sanitize(n).slice(0, 118), { x, y: ry, size: 9, font, color: INK });
    ry -= 13;
  }

  // legenda visual
  const ly = ry - 8;
  page.drawText(sanitize("LEGENDA"), { x, y: ly, size: 9, font: bold, color: GRAY });
  const items: Array<[string, RGB, RGB | null]> = [
    ["contorno/volume", EDGE, FILL],
    ["membro linear", LINE, null],
    ["painel/encaixe", EDGE_LED, FILL_LED],
    ["cota", ORANGE, null],
  ];
  let lx = x;
  for (const [name, lineC, fillC] of items) {
    if (fillC) {
      page.drawRectangle({ x: lx, y: ly - 9, width: 26, height: 9, color: fillC, opacity: 0.9, borderColor: lineC, borderWidth: 0.8 });
    } else {
      page.drawLine({ start: { x: lx, y: ly - 5 }, end: { x: lx + 26, y: ly - 5 }, thickness: 1.4, color: lineC, lineCap: LineCapStyle.Round });
    }
    lx += 30;
    page.drawText(sanitize(name), { x: lx, y: ly - 7, size: 8.5, font, color: GRAY });
    lx += font.widthOfTextAtSize(sanitize(name), 8.5) + 22;
  }
  void w;
}

/* ==================== MONTAGEM DAS FOLHAS ==================== */

/** Cotas completas de uma vista ortográfica principal (cadeias + overall + solo). */
function drawFullDimensions(
  page: PDFPage,
  proj: Projection,
  tf: TF,
  font: PDFFont,
  opts: { chainH?: boolean; chainV?: boolean; ground?: boolean } = {},
): void {
  const { chainH = true, chainV = true, ground = true } = opts;
  if (ground) drawGroundLine(page, tf, font);
  drawOverallH(page, tf, 60, font);
  drawOverallV(page, tf, 54, "left", font);
  if (chainH && proj.chainX.length >= 3) drawChainH(page, tf, proj.chainX, 28, font);
  if (chainV && proj.chainY.length >= 3) drawChainV(page, tf, proj.chainY, 24, font);
  if (ground) drawGroundClearance(page, tf, 22, font);
  let angleBudget = 3;
  for (const a of proj.angles) {
    if (angleBudget-- <= 0) break;
    drawAngleMark(page, tf.toPage(a.a), tf.toPage(a.b), font);
  }
}

/** Cotas mínimas (overall apenas) para vistas secundárias/detalhes. */
function drawBasicDimensions(page: PDFPage, tf: TF, font: PDFFont, labelSize = 8): void {
  drawOverallH(page, tf, 22, font, labelSize);
  drawOverallV(page, tf, 20, "right", font, labelSize);
}

export async function generateProjectPdf(raw: unknown, revision: number): Promise<Uint8Array> {
  const check = validateProject(raw);
  if (!check.ok || !check.doc) {
    throw new Error(`documento inválido para PDF: ${check.errors[0]?.message ?? "erro"}`);
  }
  const doc = check.doc; // normalizado v2 (v1 é convertido)

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // logo institucional (public/logo-ledcollor.png) — fallback: texto no quadro
  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedPng(readFileSync(path.join(process.cwd(), "public", "logo-ledcollor.png")));
  } catch {
    logo = null;
  }

  // ---------- projeções ----------
  const front = projectView(doc, "front");
  const side = projectView(doc, "side");
  const top = projectView(doc, "top");
  const back = projectView(doc, "back");
  const iso = projectView(doc, "iso");
  // traseira só entra quando agrega informação (geometria assimétrica em profundidade)
  const showBack = doc.elements.length > 0 && fingerprint(front) !== fingerprint(back);
  const groups = new Map<string, number>();
  for (const el of doc.elements) groups.set(elGroup(el), (groups.get(elGroup(el)) ?? 0) + 1);

  const detailGroups = [...groups.keys()].filter((g) => g !== "GERAL");
  const showDetails = detailGroups.length >= 2;
  const totalSheets = 2 + (showDetails ? 1 : 0);

  // ---------- FOLHA 1: VISTAS ORTOGRÁFICAS COTADAS ----------
  const p1 = pdf.addPage([A2.w, A2.h]);
  drawBanner(p1, font, bold, "VISTAS · FRONTAL / LATERAL / PLANTA");

  // margem esquerda maior na vista frontal para caber a cadeia vertical de cotas
  const frontBox = { x: 100, y: 230, w: 884, h: 890 };
  const sideBox = { x: 1010, y: 640, w: 645, h: 480 };
  const topBox = { x: 1010, y: 230, w: 645, h: 380 };

  const tfF = drawProjection(p1, front, frontBox, bold, "FRONTAL", { scaleNote: { value: 1 } });
  drawFullDimensions(p1, front, tfF, font, { chainH: true, chainV: true, ground: true });
  drawGroupLabels(p1, front, tfF, font);

  const tfS = drawProjection(p1, side, sideBox, bold, "LATERAL", { scaleNote: { value: 1 } });
  drawBasicDimensions(p1, tfS, font);
  if (side.chainY.length >= 3) drawChainV(p1, tfS, side.chainY, 40, font, 7.5);

  const tfT = drawProjection(p1, top, topBox, bold, "PLANTA (SUPERIOR)", { scaleNote: { value: 1 } });
  drawBasicDimensions(p1, tfT, font);
  if (top.chainX.length >= 3) drawChainH(p1, tfT, top.chainX, 40, font, 7.5);

  drawNotes(p1, doc, 24, 190, A2.w - 540, font, bold);
  drawTitleBlock(p1, doc, revision, `FOLHA 1/${totalSheets}`, font, bold, logo);

  // ---------- FOLHA 2: ISOMÉTRICA + TRASEIRA (quando faz sentido) ----------
  const p2 = pdf.addPage([A2.w, A2.h]);
  drawBanner(p2, font, bold, showBack ? "ISOMÉTRICA + TRASEIRA" : "ISOMÉTRICA");
  const isoBox = { x: 24, y: 210, w: showBack ? 950 : 1630, h: 900 };
  drawProjection(p2, iso, isoBox, bold, "ISOMÉTRICA (referência de forma — sem escala)", { labelSize: 14 });
  if (showBack) {
    const backBox = { x: 1000, y: 210, w: 655, h: 900 };
    const tfB = drawProjection(p2, back, backBox, bold, "TRASEIRA", { scaleNote: { value: 1 } });
    drawBasicDimensions(p2, tfB, font, 8.5);
  } else {
    p2.drawText(
      sanitize("Vista traseira omitida: a geometria é simétrica em profundidade (traseira idêntica à frontal espelhada)."),
      { x: 1010, y: 640, size: 9.5, font, color: GRAY },
    );
  }
  p2.drawText(
    sanitize("Cotas completas nas vistas da FOLHA 1 · ângulos e encaixes marcados onde existem."),
    { x: 24, y: 180, size: 9.5, font, color: GRAY },
  );
  drawTitleBlock(p2, doc, revision, `FOLHA 2/${totalSheets}`, font, bold, logo);

  // ---------- FOLHA 3: DETALHES POR CONJUNTO (quando útil) ----------
  if (showDetails) {
    const p3 = pdf.addPage([A2.w, A2.h]);
    drawBanner(p3, font, bold, "DETALHES POR CONJUNTO");
    const cols = 4;
    const cellW = (A2.w - 48 - (cols - 1) * 20) / cols;
    const cellH = 350;
    const list = detailGroups.slice(0, 12);
    list.forEach((g, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const box = {
        x: 24 + col * (cellW + 20),
        y: A2.h - 70 - cellH - row * (cellH + 20),
        w: cellW,
        h: cellH,
      };
      const sub = { ...doc, elements: doc.elements.filter((el) => elGroup(el) === g) };
      const proj = projectView(sub, "front");
      const tf = drawProjection(p3, proj, box, bold, `${g} · ${groups.get(g)} el.`, { labelSize: 10, pad: 18 });
      drawBasicDimensions(p3, tf, font, 7);
    });
    if (detailGroups.length > 12) {
      p3.drawText(sanitize(`+ ${detailGroups.length - 12} conjuntos não detalhados nesta folha.`), {
        x: 24,
        y: A2.h - 70 - 3 * (cellH + 20) - 6,
        size: 9,
        font,
        color: GRAY,
      });
    }
    drawTitleBlock(p3, doc, revision, `FOLHA 3/${totalSheets}`, font, bold, logo);
  }

  return pdf.save();
}
