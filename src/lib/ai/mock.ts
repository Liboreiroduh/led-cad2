/**
 * PROVIDER MOCK — transformador determinístico para dev mode / smoke tests.
 * Implementa os casos de aceite A-D sem nenhuma API key.
 * Nenhuma regra CAD fora daqui é permitida; aqui é o lugar delas no mock.
 */
import { nextId } from "@/lib/cad/blank";
import type { ProjectDocument, CadElement } from "@/lib/cad/schema";
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

function parseGround(text: string): number | null {
  const m = text.match(/p[eé]-?direito\s*(?:de)?\s*(\d+(?:[.,]\d+)?)\s*(m|metros?|mm)?/);
  if (m) {
    const v = parseFloat(m[1].replace(",", "."));
    if (m[2] && m[2].startsWith("m")) return Math.round(v * 1000);
    return Math.round(v);
  }
  return null;
}

function addPanel(doc: ProjectDocument): void {
  const { panel } = doc;
  const existing = doc.elements.find((e) => e.type === "panel");
  if (existing && existing.type === "panel") {
    existing.center = { x: 0, y: -60, z: panel.ground_clearance + panel.height / 2 };
    existing.size_x = panel.width;
    existing.size_y = 120;
    existing.size_z = panel.height;
    existing.label = `PAINEL LED ${panel.width}x${panel.height}`;
    return;
  }
  doc.elements.push({
    id: "PANEL-LED",
    type: "panel",
    role: "panel",
    profile: "",
    group: "PAINEL",
    center: { x: 0, y: -60, z: panel.ground_clearance + panel.height / 2 },
    size_x: panel.width,
    size_y: 120,
    size_z: panel.height,
    label: `PAINEL LED ${panel.width}x${panel.height}`,
  });
}

function addSimpleStructure(doc: ProjectDocument, pd: number): string[] {
  const notes: string[] = [];
  const halfW = doc.panel.width / 2;
  const yC = -doc.panel.depth / 2;
  const xs = doc.panel.width > 2500 ? [-halfW + 60, 0, halfW - 60] : [-halfW + 60, halfW - 60];
  xs.forEach((x, i) => {
    const n = String(i + 1).padStart(2, "0");
    if (!doc.elements.some((e) => e.id === `POST-${n}`)) {
      doc.elements.push({
        id: `POST-${n}`,
        type: "beam",
        role: "post",
        profile: "TUBO_219x4.75",
        group: "POSTES",
        start: { x, y: yC, z: 0 },
        end: { x, y: yC, z: pd },
        label: `POSTE ${n}`,
      });
      doc.elements.push({
        id: `BASE-${n}`,
        type: "plate",
        role: "base",
        profile: "",
        group: "BASES",
        center: { x, y: yC, z: 10 },
        size_x: 500,
        size_y: 500,
        size_z: 20,
        label: `BASE POSTE ${n}`,
      });
    }
  });
  addPanel(doc);
  notes.push("estrutura gerada em modo mock (postes + bases + painel)");
  return notes;
}

function applyMockTransform(doc: ProjectDocument, request: string): {
  explain: string;
  assumptions: string[];
  questions: string[];
} {
  const t = norm(request);
  const notes: string[] = [];
  const assumptions: string[] = [];
  const questions: string[] = [];

  // CASO B — remover postes → sustentação de parede
  const wantsWall =
    /(sem|remov|tirar|nao deve ter|n[aã]o ter).*(poste|postas|coluna)/.test(t) ||
    /sustentac[aã]o de parede|fixac[aã]o (em|na) parede|suporte de parede/.test(t);
  if (wantsWall) {
    const before = doc.elements.length;
    doc.elements = doc.elements.filter(
      (e) => !(e.type === "beam" && e.role === "post") && !(e.group === "BASES") && !(e.role === "anchor" && e.group === "FIXACAO") && !(e.type === "beam" && e.role === "brace" && e.group === "CONTRAVENTAMENTO"),
    );
    const removed = before - doc.elements.length;
    doc.installation.type = "wall";
    const pd = doc.panel.ground_clearance;
    const halfW = doc.panel.width / 2;
    const affast = 150;
    const zs = [pd + 100, pd + doc.panel.height - 100];
    let i = 1;
    for (const z of zs) {
      for (const x of [-halfW + 200, halfW - 200]) {
        doc.elements.push({
          id: `WALL-${String(i++).padStart(2, "0")}`,
          type: "beam",
          role: "support",
          profile: "METALON_100x100x3",
          group: "FIXACAO PAREDE",
          start: { x, y: -affast, z },
          end: { x, y: 0, z },
          label: "SUPORTE DE PAREDE",
        });
      }
    }
    doc.elements.push({
      id: "WALL-PLATE-01",
      type: "surface",
      role: "anchor",
      profile: "",
      group: "FIXACAO PAREDE",
      points: [
        { x: -halfW + 100, y: -affast - 20, z: pd + 50 },
        { x: halfW - 100, y: -affast - 20, z: pd + 50 },
        { x: halfW - 100, y: -affast - 20, z: pd + doc.panel.height - 50 },
        { x: -halfW + 100, y: -affast - 20, z: pd + doc.panel.height - 50 },
      ],
      thickness: 12,
      label: "PLACA DE FIXAÇÃO PAREDE",
    });
    notes.push(`removidos ${removed} elementos de suporte ao solo e criados ${i - 1} suportes de parede`);
    assumptions.push("afastamento traseiro de 150 mm assumido para fixação em parede");
    if (/(\d+)\s*mm/.test(t)) {
      const m = t.match(/afastamento.*?(\d+)\s*mm/);
      if (m) assumptions.push(`afastamento informado: ${m[1]} mm`);
    }
    return { explain: notes.join("; "), assumptions, questions };
  }

  // CASO C — cabos de fixação, 1 por coluna
  if (/cabo|cabos|tirante|estai/.test(t)) {
    const columns = doc.elements.filter((e) => e.type === "beam" && (e.role === "post" || e.role === "vertical"));
    let added = 0;
    for (const col of columns) {
      if (col.type !== "beam") continue;
      const top = col.end.z >= col.start.z ? col.end : col.start;
      const id = nextId(doc, "CABO");
      doc.elements.push({
        id,
        type: "cable",
        role: "support",
        profile: "",
        group: "CABOS",
        start: { x: top.x, y: top.y, z: top.z },
        end: { x: top.x, y: top.y - 900, z: top.z + 1200 },
        diameter: 8,
        label: "CABO DE FIXACAO",
      });
      added++;
    }
    if (added === 0) {
      // sem colunas: cria 2 estais direto no topo do painel
      const halfW = doc.panel.width / 2;
      const topZ = doc.panel.ground_clearance + doc.panel.height;
      for (const x of [-halfW + 100, halfW - 100]) {
        doc.elements.push({
          id: nextId(doc, "CABO"),
          type: "cable",
          role: "support",
          profile: "",
          group: "CABOS",
          start: { x, y: 0, z: topZ },
          end: { x, y: -900, z: topZ + 1200 },
          diameter: 8,
          label: "CABO DE FIXACAO",
        });
      }
      added = 2;
    }
    notes.push(`${added} cabo(s) de fixação criados (1 por coluna)`);
    return { explain: notes.join("; "), assumptions, questions };
  }

  // CASO D — redimensionar painel
  const dims = parseDims(t);
  if (dims && /(transforme|mude|redimension|agora (é|e)|vai (ter|ficar)|altere)/.test(t)) {
    const { w, h } = dims;
    doc.panel.width = w;
    doc.panel.height = h;
    addPanel(doc);
    // realinha postes existentes
    const posts = doc.elements.filter((e) => e.type === "beam" && e.role === "post");
    const halfW = w / 2;
    posts.forEach((p, i) => {
      if (p.type !== "beam") return;
      const x = posts.length === 1 ? 0 : -halfW + 60 + (i * (w - 120)) / (posts.length - 1);
      p.start = { x, y: p.start.y, z: p.start.z };
      p.end = { x, y: p.end.y, z: p.end.z };
    });
    notes.push(`painel redimensionado para ${w}x${h} mantendo a lógica atual`);
    assumptions.push("modulação e rails não recalculados no modo mock — revise o JSON");
    return { explain: notes.join("; "), assumptions, questions };
  }

  // CASO A — criar estrutura
  if (/(crie|criar|monte|montar|gere|gerar|novo painel|faça um)/.test(t)) {
    const pd = parseGround(t) ?? doc.panel.ground_clearance;
    if (dims) {
      doc.panel.width = dims.w;
      doc.panel.height = dims.h;
    }
    doc.panel.ground_clearance = pd;
    if (/sem poste|sem postes/.test(t)) {
      doc.installation.type = "wall";
      notes.push("documento de parede solicitado — adicione suportes via pedido específico");
      addPanel(doc);
    } else {
      const localNotes = addSimpleStructure(doc, pd);
      notes.push(...localNotes);
      if (/passarela/.test(t)) notes.push("passarela: adicione via preset de referência no modo mock");
    }
    doc.metadata.source = "mock";
    return { explain: notes.join("; "), assumptions, questions };
  }

  // adicionar um poste
  if (/(adicione|add|coloc|inclua| Acresc)/.test(t) && /poste/.test(t)) {
    const pd = doc.panel.ground_clearance;
    const yC = -doc.panel.depth / 2;
    const id = nextId(doc, "POST");
    const x = doc.panel.width / 2 + 500;
    doc.elements.push({
      id,
      type: "beam",
      role: "post",
      profile: "TUBO_219x4.75",
      group: "POSTES",
      start: { x, y: yC, z: 0 },
      end: { x, y: yC, z: pd },
      label: "POSTE ADICIONAL",
    });
    doc.elements.push({
      id: nextId(doc, "BASE"),
      type: "plate",
      role: "base",
      profile: "",
      group: "BASES",
      center: { x, y: yC, z: 10 },
      size_x: 500,
      size_y: 500,
      size_z: 20,
      label: "BASE POSTE ADICIONAL",
    });
    notes.push(`poste ${id} adicionado a x=${x}`);
    return { explain: notes.join("; "), assumptions, questions };
  }

  // guarda-corpo
  if (/guarda-?corpo|corrimao|corrimão/.test(t)) {
    const pd = doc.panel.ground_clearance;
    const halfW = doc.panel.width / 2;
    const y = -doc.panel.depth + 40;
    const id1 = nextId(doc, "GC-P");
    doc.elements.push({
      id: id1,
      type: "beam",
      role: "guardrail",
      profile: "METALON_40x40x2",
      group: "GUARDA-CORPO",
      start: { x: -halfW + 40, y, z: pd },
      end: { x: -halfW + 40, y, z: pd + 1100 },
      label: "BALIZADOR GC",
    });
    doc.elements.push({
      id: nextId(doc, "GC-RAIL"),
      type: "beam",
      role: "guardrail",
      profile: "METALON_40x40x2",
      group: "GUARDA-CORPO",
      start: { x: -halfW + 40, y, z: pd + 1100 },
      end: { x: halfW - 40, y, z: pd + 1100 },
      label: "CORRIMÃO",
    });
    notes.push("guarda-corpo h=1100 adicionado (mock simplificado)");
    return { explain: notes.join("; "), assumptions, questions };
  }

  // Fallback: mock não entendeu
  questions.push(
    "Modo MOCK: não reconheci o pedido. Tente: 'adicione um poste', 'remova os postes e use sustentação de parede', 'adicione cabos de fixação 1 por coluna', 'transforme o painel em 4x2', 'crie um painel 4x2 com pé-direito 3m'.",
  );
  return { explain: "", assumptions, questions };
}

export const mockProvider: AiProvider = {
  id: "mock",
  label: "Mock (dev)",
  defaultModels: ["mock-transformer-v1"],
  supportsImage: () => false,
  async call(input: AiCallInput): Promise<AiCallResult> {
    const started = Date.now();
    await sleep(220 + Math.random() * 380);
    const doc = clone(input.currentProject);
    const { explain, assumptions, questions } = applyMockTransform(doc, input.userRequest);
    if (input.validationFeedback) {
      // mock sempre válido; apenas registra
      assumptions.push("retry após feedback de validação");
    }
    const status = questions.length && !explain ? "needs_input" : "ready";
    const text = JSON.stringify({
      status,
      explain: explain || "Nenhuma alteração aplicada.",
      assumptions,
      questions,
      project: status === "ready" ? doc : null,
    });
    return { text, latencyMs: Date.now() - started, model: input.model };
  },
  async test(input): Promise<{ latencyMs: number; model: string; detail: string }> {
    await sleep(120);
    return { latencyMs: 120, model: input.model, detail: "mock sempre ativo" };
  },
};

// mantém o tipo CadElement referenciado para clareza de contrato
export type _CadElementRef = CadElement;
