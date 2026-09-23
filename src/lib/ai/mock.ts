/**
 * PROVIDER MOCK v2 — transformador determinístico para dev mode / smoke tests.
 * Opera no formato GEOMETRY v2 ({id, geometry, metadata}) sem nenhuma API key.
 * Casos: A (redimensionar painel), B (parede), C (cabos), G (peça inclinada), arco, mesh demo.
 * Nenhuma regra CAD fora daqui é permitida; aqui é o lugar delas no mock.
 */
import { nextId } from "@/lib/cad/blank";
import type { ProjectDocument, GeometryElement, Geometry } from "@/lib/cad/schema";
import type { AiCallInput, AiCallResult, AiProvider } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clone(doc: ProjectDocument): ProjectDocument {
  return JSON.parse(JSON.stringify(doc)) as ProjectDocument;
}

function parseDims(text: string): { w: number; h: number } | null {
  // "4x2", "4000x2000", "4 x 2 metros", "2x4"
  const mm = text.match(/(\d{4,5})\s*[x×]\s*(\d{4,5})/);
  if (mm) return { w: parseInt(mm[1], 10), h: parseInt(mm[2], 10) };
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros?)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:m|metros?)?/);
  if (m && /metro|\bm\b/.test(text)) {
    const w = Math.round(parseFloat(m[1].replace(",", ".")) * 1000);
    const h = Math.round(parseFloat(m[2].replace(",", ".")) * 1000);
    if (w >= 500 && h >= 500) return { w, h };
  }
  return null;
}

/* ======================= helpers de geometria v2 ======================= */

function isLed(el: GeometryElement): boolean {
  return el.metadata?.led === true;
}
function roleOf(el: GeometryElement): string {
  return typeof el.metadata?.role === "string" ? el.metadata.role : "";
}
function groupOf(el: GeometryElement): string {
  return typeof el.metadata?.group === "string" ? el.metadata.group : "";
}
function mk(
  id: string,
  geometry: Geometry,
  metadata: Record<string, unknown> = {},
): GeometryElement {
  return { id, geometry, metadata: { name: id, label: id, ...metadata } };
}

function findPanel(doc: ProjectDocument): GeometryElement | undefined {
  return doc.elements.find((e) => isLed(e));
}

/** Cria/atualiza o painel LED (box com led:true) e o espelha em metadata.extensions.panel. */
function setPanel(doc: ProjectDocument, w: number, h: number): void {
  const existing = findPanel(doc);
  const size: [number, number, number] = [w, 120, h];
  const depth = (size[1] as number) ?? 120;
  let zBase = 3000;
  if (existing && existing.geometry.type === "box") {
    zBase = existing.geometry.center.z - existing.geometry.size[2] / 2;
  }
  const center = { x: 0, y: -depth / 2, z: zBase + h / 2 };
  if (existing && existing.geometry.type === "box") {
    existing.geometry.size = size;
    existing.geometry.center = center;
    existing.metadata.label = `PAINEL LED ${w}x${h}`;
    existing.metadata.name = `PAINEL LED ${w}x${h}`;
  } else if (existing) {
    // painel não-box: substitui por box led
    doc.elements = doc.elements.filter((e) => e.id !== existing.id);
    doc.elements.push(mk(existing.id, { type: "box", center, size }, { ...existing.metadata, led: true, label: `PAINEL LED ${w}x${h}` }));
  } else {
    doc.elements.push(mk("PANEL-LED", { type: "box", center, size }, { group: "PAINEL", role: "panel", led: true, label: `PAINEL LED ${w}x${h}` }));
  }
  const ext = (doc.metadata.extensions ?? {}) as Record<string, unknown>;
  const oldPanel = (ext.panel ?? {}) as Record<string, unknown>;
  doc.metadata.extensions = {
    ...ext,
    panel: {
      width: w,
      height: h,
      depth: oldPanel.depth ?? depth,
      ground_clearance: oldPanel.ground_clearance ?? zBase,
    },
  };
}

function panelWidth(doc: ProjectDocument): number {
  const dims = (doc.metadata.extensions as Record<string, unknown> | undefined)?.panel as { width?: number } | undefined;
  if (dims && typeof dims.width === "number") return dims.width;
  const p = findPanel(doc);
  if (p && p.geometry.type === "box") return p.geometry.size[0];
  return 1920;
}

function posts(doc: ProjectDocument): GeometryElement[] {
  return doc.elements.filter((e) => e.geometry.type === "beam" && roleOf(e) === "post");
}

/* ======================= casos determinísticos ======================= */

function applyMockTransform(doc: ProjectDocument, request: string): {
  explain: string;
  assumptions: string[];
  questions: string[];
} {
  const t = norm(request);
  const assumptions: string[] = [];
  const questions: string[] = [];

  // CASO G + TESTE ARCO — estrutura curva em arco com mastro central
  if (/(arco|curva|arc)/.test(t) && /(estrutura|crie|monte|gere)/.test(t)) {
    const w = panelWidth(doc);
    const r = Math.max(w / 2, 1000);
    const n = 9;
    const arcGroupId = `ARC-${String(doc.elements.length + 1).padStart(2, "0")}`;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (i / (n - 1));
      const a1 = Math.PI * ((i + 1) / (n - 1));
      const p0 = { x: -r * Math.cos(a0), y: 0, z: r * Math.sin(a0) };
      const p1 = { x: -r * Math.cos(a1), y: 0, z: r * Math.sin(a1) };
      doc.elements.push(
        mk(`${arcGroupId}-${String(i + 1).padStart(2, "0")}`,
          { type: "beam", start: p0, end: p1, section: { type: "square", width: 60, height: 60, diameter: 0 } },
          { group: "ARCO", role: "arco", material: "aco" }),
      );
    }
    // mastro central inclinado
    const mastroId = nextId(doc, "MASTRO");
    doc.elements.push(
      mk(mastroId,
        { type: "cylinder", start: { x: 0, y: 0, z: 0 }, end: { x: r * 0.35, y: 0, z: r * 0.95 }, diameter: 150 },
        { group: "ARCO", role: "mastro inclinado", material: "aco" }),
    );
    return { explain: `arco de ${n} segmentos + mastro central inclinado gerados em modo mock`, assumptions, questions };
  }

  // CASO G — peça inclinada/diagonal ligando a parte superior ao solo
  const wantsDiagonal = /(inclinad|diagonal|escora|tirante diagonal|peca.*(inclin|diagon))/i.test(t) || /ligue|ligando/.test(t);
  if (wantsDiagonal) {
    const cols = posts(doc);
    const base = cols[0] && cols[0].geometry.type === "beam" ? cols[0] : null;
    const topZ = (() => {
      const p = findPanel(doc);
      if (p && p.geometry.type === "box") return p.geometry.center.z - p.geometry.size[2] / 2;
      return 3000;
    })();
    const startX = base && base.geometry.type === "beam" ? base.geometry.end.x : -panelWidth(doc) / 2;
    const startY = base && base.geometry.type === "beam" ? base.geometry.end.y : 0;
    const id = nextId(doc, "DIAG");
    doc.elements.push(
      mk(id,
        { type: "beam", start: { x: startX, y: startY, z: 0 }, end: { x: -startX * 0.9, y: startY, z: topZ }, section: { type: "round", width: 40, height: 40, diameter: 40 } },
        { group: "CONTRAVENTAMENTO", role: "escora diagonal", material: "aco" }),
    );
    return { explain: `peça inclinada ${id} criada ligando o solo à parte superior (mock)`, assumptions, questions };
  }

  // CASO C — cabos/tirantes por coluna
  const caboMatch = t.match(/(\d+)?\s*(cabos?|tirantes?)/);
  if (caboMatch) {
    const n = Math.max(1, Math.min(4, parseInt(caboMatch[1] ?? "1", 10) || 1));
    const cols = posts(doc);
    let count = 0;
    for (const col of cols) {
      if (col.geometry.type !== "beam") continue;
      const top = col.geometry.end;
      const bottom = col.geometry.start;
      const back = { x: top.x, y: top.y - 800, z: top.z };
      for (let i = 0; i < n; i++) {
        const z = bottom.z + ((top.z - bottom.z) * (i + 1)) / (n + 1);
        const id = nextId(doc, "CABO");
        doc.elements.push(
          mk(id,
            { type: "line", start: { x: top.x, y: top.y, z }, end: back, thickness: 8 },
            { group: "CABOS", role: "cable", material: "aco", diameter: 8 }),
        );
        count++;
      }
      // ancoragem no solo
      const idAnc = nextId(doc, "ANC");
      doc.elements.push(
        mk(idAnc,
          { type: "cylinder", start: back, end: { x: back.x, y: back.y, z: 0 }, diameter: 24 },
          { group: "CABOS", role: "ancoragem", material: "aco" }),
      );
    }
    if (count > 0) {
      return { explain: `${count} cabo(s) + ancoragens gerados em modo mock (sem handler especial — é geometry.type=line)`, assumptions, questions };
    }
    questions.push("nenhuma coluna (role=post) encontrada para ancorar os cabos — crie postes antes");
    return { explain: "sem colunas para cabos", assumptions, questions };
  }

  // CASO B — remover postes → sustentação de parede
  const wantsWall =
    /(sem|remov|tirar|nao deve ter|n[aã]o ter).*(poste|postas|coluna)/.test(t) ||
    /sustentac[aã]o de parede|fixac[aã]o (em|na) parede|suporte de parede/.test(t);
  if (wantsWall) {
    const before = doc.elements.length;
    doc.elements = doc.elements.filter((e) => {
      const r = roleOf(e);
      const g = groupOf(e);
      return !(r === "post" || r === "brace" || r === "anchor" || g === "BASES" || g === "CONTRAVENTAMENTO");
    });
    const removed = before - doc.elements.length;
    const w = panelWidth(doc);
    const pd = 3000;
    // suportes de parede (box) + fixações (cylinder) — sem "add_wall_support" programado
    for (const x of [-w / 2 + 60, 0, w / 2 - 60].filter((v, i, a) => a.indexOf(v) === i)) {
      const idS = nextId(doc, "SUP");
      doc.elements.push(
        mk(idS,
          { type: "box", center: { x, y: 60, z: pd - 100 }, size: [200, 120, 200] },
          { group: "FIXACAO", role: "suporte de parede", material: "aco" }),
      );
      const idF = nextId(doc, "FIX");
      doc.elements.push(
        mk(idF,
          { type: "cylinder", start: { x, y: 120, z: pd - 100 }, end: { x, y: 0, z: pd - 100 }, diameter: 20 },
          { group: "FIXACAO", role: "chumbador", material: "aco" }),
      );
    }
    const ext = (doc.metadata.extensions ?? {}) as Record<string, unknown>;
    doc.metadata.extensions = { ...ext, installation: { type: "wall", environment: "outdoor" } };
    return { explain: `${removed} elementos removidos; fixações de parede geradas em modo mock`, assumptions, questions };
  }

  // CASO A — redimensionar painel ("4x2", "4000x2000", "pé-direito…")
  const dims = parseDims(t);
  const pdMatch = t.match(/p[eé]-?direito\s*(?:de)?\s*(\d+(?:[.,]\d+)?)\s*(m|metros?|mm)?/);
  if (dims || pdMatch) {
    const curW = panelWidth(doc);
    const w = dims ? dims.w : curW;
    const h = dims ? dims.h : (() => {
      const p = findPanel(doc);
      if (p && p.geometry.type === "box") return p.geometry.size[2];
      return 1920;
    })();
    let zBase = 3000;
    if (pdMatch) {
      const v = parseFloat(pdMatch[1].replace(",", "."));
      zBase = pdMatch[2] && pdMatch[2].startsWith("m") ? Math.round(v * 1000) : Math.round(v);
      assumptions.push(`pé-direito assumido: ${zBase}mm`);
    }
    setPanel(doc, w, h);
    // postes acompanham o novo topo (caso existam)
    for (const col of posts(doc)) {
      if (col.geometry.type === "beam") {
        col.geometry.end = { ...col.geometry.end, z: zBase };
      }
    }
    return { explain: `painel redimensionado para ${w}x${h}mm (mock, geometry v2)`, assumptions, questions };
  }

  // Teste E — mesh arbitrária sob pedido explícito
  if (/(mesh|malha|triangul)/.test(t)) {
    const id = nextId(doc, "MESH");
    doc.elements.push(
      mk(id,
        {
          type: "mesh",
          vertices: [
            { x: 0, y: 0, z: 2500 },
            { x: 1000, y: 0, z: 2500 },
            { x: 1000, y: 1000, z: 2500 },
          ],
          faces: [[0, 1, 2]],
        },
        { group: "MODELAGEM", role: "mesh de teste" }),
    );
    return { explain: `mesh triangular ${id} criada (escape universal, mock)`, assumptions, questions };
  }

  // padrão — nenhum caso reconhecido: documento devolvido intacto (still ready)
  questions.push("pedido não reconhecido pelo mock — configure Gemini/Z.ai para IA real");
  return { explain: "nenhuma transformação aplicada (mock)", assumptions, questions };
}

export const mockProvider: AiProvider = {
  id: "mock",
  label: "Mock (dev)",
  defaultModels: ["mock-transformer-v1"],
  supportsImage: () => false,
  async call(input: AiCallInput): Promise<AiCallResult> {
    const started = Date.now();
    await sleep(300); // simula latência
    const doc = clone(input.currentProject);
    const { explain, assumptions, questions } = applyMockTransform(doc, input.userRequest);
    const text = JSON.stringify({
      status: "ready",
      explain: input.attachments.length
        ? `${explain} (anexo ignorado no mock)`
        : explain,
      assumptions,
      questions,
      project: doc,
    });
    return { text, latencyMs: Date.now() - started, model: input.model };
  },
  async test({ model }) {
    await sleep(120);
    return { latencyMs: 120, model, detail: "mock sempre ativo" };
  },
};
