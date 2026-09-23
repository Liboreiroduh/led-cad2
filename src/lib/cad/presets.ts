/**
 * PRESETS — cada preset é um ProjectDocument COMPLETO e válido.
 * Nada de template/enrichment/intent/operacões: carregar preset = carregar JSON.
 *
 * IMPORTANTE: bays estruturais ≠ grade de gabinetes.
 */
import type { ProjectDocument } from "./schema";
import { legacyProjectToGeometry } from "./legacy-adapter";

/** Formato legado v1 — usado APENAS pelo gerador interno; a saída pública é sempre v2. */
interface LegacyProjectDoc {
  schema_version: 1;
  units: "mm";
  project: { id: string; name: string; description: string };
  panel: { width: number; height: number; depth: number; ground_clearance: number };
  installation: { type: string; environment: string };
  elements: Array<Record<string, unknown>>;
  assumptions: string[];
  metadata: { source: string; preset_id: string | null; reviews: never[] };
}

export interface PresetRef {
  id: string;
  name: string;
  description: string;
}

export interface RefSpec {
  id: string;
  name: string;
  description: string;
  panelW: number;
  panelH: number;
  pd: number; // pé-direito (ground_clearance)
  cage: number; // profundidade da gaiola/passarela
  baysX: number; // modulação estrutural em X
  railSpacing: number;
  frameProfile: string;
  secondaryProfile: string;
  postProfile: string;
  assumptions: string[];
}

export const REF_SPECS: RefSpec[] = [
  {
    id: "REF_2000X4000",
    name: "2000 × 4000 — Outdoor",
    description: "Painel vertical 2×4 m, PD 2000, 2 postes, gaiola 650, bays X=2, rails 1000.",
    panelW: 2000,
    panelH: 4000,
    pd: 2000,
    cage: 650,
    baysX: 2,
    railSpacing: 1000,
    frameProfile: "METALON_60x60x2",
    secondaryProfile: "METALON_40x40x2",
    postProfile: "TUBO_380_t6.35",
    assumptions: [
      "Referência validada do sistema anterior (PD 2000).",
      "Bays estruturais ≠ grade de gabinetes.",
    ],
  },
  {
    id: "REF_2000X5000",
    name: "2000 × 5000 — Outdoor",
    description: "Painel vertical 2×5 m, PD 2000, 2 postes, gaiola 800, bays X=2, rails 1000.",
    panelW: 2000,
    panelH: 5000,
    pd: 2000,
    cage: 800,
    baysX: 2,
    railSpacing: 1000,
    frameProfile: "METALON_60x60x2",
    secondaryProfile: "METALON_40x40x2",
    postProfile: "TUBO_380_t4.8",
    assumptions: [
      "Referência original usava PERFIL H 310×93 — substituído por TUBO_380_t4.8 (fallback).",
      "Bays estruturais ≠ grade de gabinetes.",
    ],
  },
  {
    id: "REF_3000X2000",
    name: "3000 × 2000 — Outdoor",
    description: "Painel 3×2 m, PD 3000, 2 postes, gaiola 650, bays X=3, rails 1000.",
    panelW: 3000,
    panelH: 2000,
    pd: 3000,
    cage: 650,
    baysX: 3,
    railSpacing: 1000,
    frameProfile: "METALON_60x60x2",
    secondaryProfile: "METALON_40x40x2",
    postProfile: "TUBO_250x10",
    assumptions: ["Bays estruturais ≠ grade de gabinetes."],
  },
  {
    id: "REF_4000X2000",
    name: "4000 × 2000 — Outdoor",
    description: "Painel 4×2 m, PD 3000, 2 postes, gaiola 650, bays X=4, rails 1000.",
    panelW: 4000,
    panelH: 2000,
    pd: 3000,
    cage: 650,
    baysX: 4,
    railSpacing: 1000,
    frameProfile: "METALON_60x60x2",
    secondaryProfile: "METALON_40x40x2",
    postProfile: "TUBO_380_t4.8",
    assumptions: ["Bays estruturais ≠ grade de gabinetes."],
  },
];

function beam(
  id: string,
  role: string,
  profile: string,
  group: string,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  label = "",
) {
  return {
    id,
    type: "beam" as const,
    role: role as never,
    profile,
    group,
    start,
    end,
    label,
  };
}

/** Constrói a estrutura completa de referência a partir da spec (formato legado; convertido na saída). */
export function buildReferenceProject(spec: RefSpec): LegacyProjectDoc {
  const { panelW: W, panelH: H, pd, cage, railSpacing, frameProfile, secondaryProfile, postProfile } = spec;
  const halfW = W / 2;
  const postInset = 60;
  const postX = [-(halfW - postInset), +(halfW - postInset)];
  const yC = -cage / 2;
  const yFront = 0;
  const yBack = -cage;
  const topZ = pd + H;
  const elements: LegacyProjectDoc["elements"] = [];

  // Painel LED (referência visual, não aço)
  elements.push({
    id: "PANEL-LED",
    type: "panel",
    role: "panel",
    profile: "",
    group: "PAINEL",
    center: { x: 0, y: -60, z: pd + H / 2 },
    size_x: W,
    size_y: 120,
    size_z: H,
    label: `PAINEL LED ${W}x${H}`,
  });

  // Postes + bases + chumbadores
  postX.forEach((x, i) => {
    const n = String(i + 1).padStart(2, "0");
    elements.push(
      beam(`POST-${n}`, "post", postProfile, "POSTES", { x, y: yC, z: 0 }, { x, y: yC, z: pd }, `POSTE ${n}`),
    );
    elements.push({
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
    for (const [sx, sy] of [
      [-150, -150],
      [150, -150],
      [-150, 150],
      [150, 150],
    ] as const) {
      elements.push({
        id: `BOLT-${n}${sx < 0 ? "A" : "B"}${sy < 0 ? "1" : "2"}`,
        type: "bolt",
        role: "anchor",
        profile: "",
        group: "FIXACAO",
        center: { x: x + sx, y: yC + sy, z: 25 },
        diameter: 16,
        length: 150,
        label: "CHUMBADOR M16",
      });
    }
  });

  // Gaiola — anéis inferior e superior (frente e trás) + laterais + montantes
  const rings: Array<[string, number, number, string]> = [
    ["INF", pd, yFront, "GAIOLA FRENTE"],
    ["INF", pd, yBack, "GAIOLA TRAS"],
    ["SUP", topZ, yFront, "GAIOLA FRENTE"],
    ["SUP", topZ, yBack, "GAIOLA TRAS"],
  ];
  let ringIdx = 1;
  for (const [tag, z, y, group] of rings) {
    elements.push(
      beam(`FRAME-${String(ringIdx++).padStart(2, "0")}`, "horizontal", frameProfile, group, { x: -halfW, y, z }, { x: halfW, y, z }, `ANEL ${tag}`),
    );
  }
  // Conexões laterais (frente↔trás) inferior e superior
  for (const x of [-halfW, halfW]) {
    for (const z of [pd, topZ]) {
      elements.push(
        beam(`SIDE-${String(ringIdx++).padStart(2, "0")}`, "horizontal", frameProfile, "GAIOLA LATERAL", { x, y: yFront, z }, { x, y: yBack, z }, "LIGAÇÃO LATERAL"),
      );
    }
  }
  // Montantes de canto (frente)
  for (const x of [-halfW, halfW]) {
    elements.push(
      beam(`MONT-${String(ringIdx++).padStart(2, "0")}`, "vertical", frameProfile, "GAIOLA FRENTE", { x, y: yFront, z: pd }, { x, y: yFront, z: topZ }, "MONTANTE DE CANTO"),
    );
  }

  // Rails horizontais (spacing vertical = railSpacing) na face frontal
  let railIdx = 1;
  for (let z = pd + railSpacing; z < topZ - 1; z += railSpacing) {
    elements.push(
      beam(`RAIL-${String(railIdx++).padStart(2, "0")}`, "horizontal", secondaryProfile, "MODULACAO", { x: -halfW, y: yFront, z }, { x: halfW, y: yFront, z }, `RAIL MODULAÇÃO`),
    );
  }

  // Passarela traseira (no nível do anel inferior)
  elements.push({
    id: "PASS-01",
    type: "plate",
    role: "walkway",
    profile: "",
    group: "PASSARELA",
    center: { x: 0, y: yC, z: pd - 15 },
    size_x: W,
    size_y: cage,
    size_z: 30,
    label: "PASSARELA MANUTENÇÃO",
  });

  // Guarda-corpo h=1100 na borda traseira
  const gcY = yBack + 40;
  const gcX = [-(halfW - 40), +(halfW - 40)];
  gcX.forEach((x, i) => {
    elements.push(
      beam(`GC-P${i + 1}`, "guardrail", secondaryProfile, "GUARDA-CORPO", { x, y: gcY, z: pd }, { x, y: gcY, z: pd + 1100 }, "BALIZADOR GC"),
    );
  });
  elements.push(
    beam("GC-RAIL-SUP", "guardrail", secondaryProfile, "GUARDA-CORPO", { x: gcX[0], y: gcY, z: pd + 1100 }, { x: gcX[1], y: gcY, z: pd + 1100 }, "CORRIMÃO SUPERIOR"),
  );
  elements.push(
    beam("GC-RAIL-MED", "guardrail", secondaryProfile, "GUARDA-CORPO", { x: gcX[0], y: gcY, z: pd + 550 }, { x: gcX[1], y: gcY, z: pd + 550 }, "CORRIMÃO INTERMEDIÁRIO"),
  );

  // Contraventamento em X na face traseira (zona dos postes)
  const bx = halfW - postInset;
  elements.push(
    beam("BRACE-01", "brace", secondaryProfile, "CONTRAVENTAMENTO", { x: -bx, y: yBack, z: 100 }, { x: bx, y: yBack, z: pd - 100 }, "DIAGONAL X"),
  );
  elements.push(
    beam("BRACE-02", "brace", secondaryProfile, "CONTRAVENTAMENTO", { x: bx, y: yBack, z: 100 }, { x: -bx, y: yBack, z: pd - 100 }, "DIAGONAL X"),
  );

  return {
    schema_version: 1,
    units: "mm",
    project: {
      id: spec.id,
      name: spec.name,
      description: spec.description,
    },
    panel: {
      width: W,
      height: H,
      depth: cage,
      ground_clearance: pd,
    },
    installation: { type: "post", environment: "outdoor" },
    elements,
    assumptions: [...spec.assumptions],
    metadata: { source: "preset", preset_id: spec.id, reviews: [] },
  };
}

/** Gerador interno continua produzindo o formato clássico; a saída pública é SEMPRE v2. */
let _cache: Map<string, ProjectDocument> | null = null;
export function referencePresets(): Map<string, ProjectDocument> {
  if (!_cache) {
    _cache = new Map(
      REF_SPECS.map((s) => [s.id, legacyProjectToGeometry(buildReferenceProject(s))]),
    );
  }
  return _cache;
}

export function presetList(): PresetRef[] {
  return REF_SPECS.map((s) => ({ id: s.id, name: s.name, description: s.description }));
}
