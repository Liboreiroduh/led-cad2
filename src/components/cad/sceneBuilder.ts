/**
 * Scene builder — converte ProjectDocument em geometria Three.js.
 * Mapeamento: model(X=largura, Y=profundidade, Z=altura) → three(x, y=altura, z=profundidade).
 * Estados de diff: added=verde, modified=laranja, removed=vermelho (ghost), unchanged=cinza.
 */
import * as THREE from "three";
import { getProfile } from "@/lib/cad/profiles";
import type { ProjectDocument } from "@/lib/cad/schema";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";
export type StatusMap = Record<string, DiffStatus>;

export const STATUS_COLORS: Record<DiffStatus, number> = {
  added: 0x16a34a,
  removed: 0xdc2626,
  modified: 0xea580c,
  unchanged: 0x64748b,
};

const STEEL = 0x8b95a1;
const PANEL = 0x1f2937;

/** Textura de painel LED (módulos + pixels) gerada em canvas — referência visual. */
let _panelTexture: THREE.CanvasTexture | null = null;
function panelTexture(): THREE.CanvasTexture {
  if (_panelTexture) return _panelTexture;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a0e14";
  g.fillRect(0, 0, c.width, c.height);
  // grade de módulos (gabinetes)
  const modW = c.width / 8;
  const modH = c.height / 4;
  g.strokeStyle = "#1d2735";
  g.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo(i * modW, 0);
    g.lineTo(i * modW, c.height);
    g.stroke();
  }
  for (let j = 0; j <= 4; j++) {
    g.beginPath();
    g.moveTo(0, j * modH);
    g.lineTo(c.width, j * modH);
    g.stroke();
  }
  // pixels LED (sutil variação)
  for (let y = 6; y < c.height; y += 10) {
    for (let x = 6; x < c.width; x += 10) {
      const v = Math.random();
      g.fillStyle =
        v > 0.985 ? "rgba(249,115,22,0.55)" : v > 0.9 ? "rgba(148,163,184,0.20)" : "rgba(41,52,66,0.55)";
      g.fillRect(x, y, 4, 4);
    }
  }
  _panelTexture = new THREE.CanvasTexture(c);
  _panelTexture.colorSpace = THREE.SRGBColorSpace;
  return _panelTexture;
}

function v3(p: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.z, p.y);
}

function orientedMesh(
  a: THREE.Vector3,
  b: THREE.Vector3,
  makeGeometry: (len: number) => THREE.BufferGeometry,
  axis: THREE.Vector3,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 0.001);
  const mesh = new THREE.Mesh(makeGeometry(len));
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(axis, dir.normalize());
  return mesh;
}

export interface BuiltScene {
  group: THREE.Group;
  byId: Map<string, THREE.Object3D[]>;
  bbox: THREE.Box3;
}

export function buildProjectGroup(
  doc: ProjectDocument,
  statuses?: StatusMap,
  opts: { skipUnchanged?: boolean } = {},
): BuiltScene {
  const group = new THREE.Group();
  const byId = new Map<string, THREE.Object3D[]>();
  const register = (id: string, obj: THREE.Object3D) => {
    obj.userData.elementId = id;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(obj);
  };

  const mkSteel = (color: number, status?: DiffStatus, opacity = 1) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.55,
      roughness: 0.5,
      transparent: opacity < 1 || (status !== undefined && status !== "unchanged"),
      opacity: status === "added" || status === "removed" ? 0.55 : status === "modified" ? 0.8 : opacity,
      emissive: status && status !== "unchanged" ? STATUS_COLORS[status] : 0x000000,
      emissiveIntensity: status && status !== "unchanged" ? 0.18 : 0,
      side: THREE.DoubleSide,
    });

  const bbox = new THREE.Box3();

  for (const el of doc.elements) {
    const status = statuses?.[el.id];
    if (status === "unchanged" && opts.skipUnchanged) continue;

    if (el.type === "beam") {
      const prof = getProfile(el.profile);
      const w = prof ? prof.w : 50;
      const isRound = prof?.kind === "round";
      const a = v3(el.start);
      const b = v3(el.end);
      const color = status && status !== "unchanged" ? STATUS_COLORS[status] : STEEL;
      const mat = mkSteel(color, status);
      let mesh: THREE.Mesh;
      if (isRound) {
        mesh = orientedMesh(
          a,
          b,
          (len) => new THREE.CylinderGeometry(w / 2, w / 2, len, 20),
          new THREE.Vector3(0, 1, 0),
        );
      } else {
        mesh = orientedMesh(
          a,
          b,
          (len) => new THREE.BoxGeometry(w, w, len),
          new THREE.Vector3(0, 0, 1),
        );
      }
      mesh.material = mat;
      register(el.id, mesh);
      group.add(mesh);
      bbox.expandByObject(mesh);
    } else if (el.type === "plate") {
      const color = status && status !== "unchanged" ? STATUS_COLORS[status] : 0x5d6673;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(el.size_x, el.size_z, el.size_y),
        mkSteel(color, status),
      );
      mesh.position.copy(v3(el.center));
      register(el.id, mesh);
      group.add(mesh);
      bbox.expandByObject(mesh);
    } else if (el.type === "bolt") {
      const color = status && status !== "unchanged" ? STATUS_COLORS[status] : 0x475569;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(el.diameter / 2, el.diameter / 2, el.length, 12),
        mkSteel(color, status),
      );
      mesh.position.copy(v3(el.center));
      register(el.id, mesh);
      group.add(mesh);
      bbox.expandByObject(mesh);
    } else if (el.type === "panel") {
      const statusColor = status && status !== "unchanged" ? STATUS_COLORS[status] : PANEL;
      const baseMat = new THREE.MeshStandardMaterial({
        color: statusColor,
        metalness: 0.2,
        roughness: 0.35,
        transparent: true,
        opacity: status === "removed" || status === "added" ? 0.5 : 0.72,
        emissive: status && status !== "unchanged" ? STATUS_COLORS[status] : 0xf97316,
        emissiveIntensity: status && status !== "unchanged" ? 0.25 : 0.08,
        side: THREE.DoubleSide,
      });
      // face frontal (three +Z) recebe a textura de módulos LED
      const frontMat = baseMat.clone();
      frontMat.map = panelTexture();
      frontMat.emissiveMap = panelTexture();
      frontMat.emissive = new THREE.Color(0xffffff);
      frontMat.emissiveIntensity = status && status !== "unchanged" ? 0.35 : 0.5;
      const geo = new THREE.BoxGeometry(el.size_x, el.size_z, el.size_y);
      const mesh = new THREE.Mesh(geo, [
        baseMat,
        baseMat,
        baseMat,
        baseMat,
        frontMat,
        baseMat,
      ]);
      mesh.position.copy(v3(el.center));
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55 }),
      );
      mesh.add(edges);
      register(el.id, mesh);
      register(el.id, edges);
      group.add(mesh);
      bbox.expandByObject(mesh);
    } else if (el.type === "cable") {
      const color = status && status !== "unchanged" ? STATUS_COLORS[status] : 0x6b7280;
      const mesh = orientedMesh(
        v3(el.start),
        v3(el.end),
        (len) => new THREE.CylinderGeometry(Math.max(el.diameter / 2, 2), Math.max(el.diameter / 2, 2), len, 10),
        new THREE.Vector3(0, 1, 0),
      );
      mesh.material = mkSteel(color, status);
      register(el.id, mesh);
      group.add(mesh);
      bbox.expandByObject(mesh);
    } else if (el.type === "surface") {
      const geometry = new THREE.BufferGeometry();
      const pts = el.points.map((p) => v3(p));
      const vertices: number[] = [];
      for (let i = 1; i < pts.length - 1; i++) {
        vertices.push(pts[0].x, pts[0].y, pts[0].z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const color = status && status !== "unchanged" ? STATUS_COLORS[status] : 0x94a3b8;
      const mesh = new THREE.Mesh(geometry, mkSteel(color, status, 0.85));
      register(el.id, mesh);
      group.add(mesh);
      bbox.expandByObject(mesh);
    }
  }

  return { group, byId, bbox };
}

export function buildEnvironment(): THREE.Group {
  const env = new THREE.Group();
  const size = 60;
  const divisions = 60;
  const grid = new THREE.GridHelper(size, divisions, 0xb8c0ca, 0xd8dee6);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  env.add(grid);

  // eixo de referência sutil (laranja) no solo
  const axisMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.35 });
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, 0, 0), new THREE.Vector3(6, 0, 0)]), axisMat);
  env.add(axis);
  return env;
}

/* ============================ COTAS (DIMENSÕES) ============================ */

const DIM_COLOR = 0x475569;
const DIM_ACCENT = 0xea580c;

function labelSprite(text: string, worldHeight: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  // fundo arredondado
  const r = 24;
  g.fillStyle = "rgba(255,255,255,0.94)";
  g.strokeStyle = "#ea580c";
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(6, 14, c.width - 12, c.height - 28, r);
  g.fill();
  g.stroke();
  g.fillStyle = "#1e293b";
  g.font = "bold 64px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(worldHeight * 4, worldHeight, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function fmtDim(mm: number): string {
  return `${Math.round(mm)} mm${mm >= 1000 ? ` (${(mm / 1000).toFixed(2)} m)` : ""}`;
}

function dimLine(a: THREE.Vector3, b: THREE.Vector3, text: string, labelH: number, labelOffset: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const lineMat = new THREE.LineBasicMaterial({ color: DIM_COLOR });
  const accentMat = new THREE.LineBasicMaterial({ color: DIM_ACCENT });

  // linha principal
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), accentMat));

  // setas (cones) nas duas pontas
  const arrowLen = labelH * 0.5;
  const arrowGeo = new THREE.ConeGeometry(arrowLen * 0.35, arrowLen, 10);
  for (const [tip, back] of [[b, a], [a, b]] as const) {
    const cone = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: DIM_ACCENT }));
    cone.position.copy(tip).sub(dir.clone().multiplyScalar(arrowLen * 0.5));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone());
    g.add(cone);
  }

  // extensões + ticks nas pontas
  const extDir = labelOffset.clone().normalize();
  for (const p of [a, b]) {
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([p, p.clone().add(labelOffset)]),
      lineMat,
    ));
    const tick = new THREE.Mesh(
      new THREE.SphereGeometry(labelH * 0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: DIM_COLOR }),
    );
    tick.position.copy(p);
    g.add(tick);
    void extDir;
  }

  // rótulo
  const label = labelSprite(text, labelH);
  label.position.copy(a).add(b).multiplyScalar(0.5).add(labelOffset.clone().multiplyScalar(0.65)).add(new THREE.Vector3(0, labelH * 0.55, 0));
  g.add(label);
  return g;
}

/**
 * Cotas do envelope: LARGURA (X), ALTURA (Z solo) e PROFUNDIDADE (Y).
 * Mapeamento model→three: (x, altura=y, profundidade=z).
 */
export function buildDimensionGroup(bbox: THREE.Box3): THREE.Group | null {
  if (bbox.isEmpty()) return null;
  const size = bbox.getSize(new THREE.Vector3());
  const min = bbox.min.clone();
  const max = bbox.max.clone();
  const diag = size.length();
  const off = diag * 0.07;
  const labelH = Math.max(diag * 0.035, 40);
  const g = new THREE.Group();
  g.name = "dimensions";

  // LARGURA X — na frente (z = max.z + off), ao nível do solo (y = min.y)
  const zFront = max.z + off;
  g.add(dimLine(
    new THREE.Vector3(min.x, min.y, zFront),
    new THREE.Vector3(max.x, min.y, zFront),
    `L ${fmtDim(size.x)}`,
    labelH,
    new THREE.Vector3(0, 0, off * 0.55),
  ));

  // ALTURA Y (Z do modelo) — no canto esquerdo (x = min.x - off, z = min.z)
  const xLeft = min.x - off;
  g.add(dimLine(
    new THREE.Vector3(xLeft, min.y, min.z),
    new THREE.Vector3(xLeft, max.y, min.z),
    `H ${fmtDim(size.y)}`,
    labelH,
    new THREE.Vector3(-off * 0.55, 0, 0),
  ));

  // PROFUNDIDADE Z (Y do modelo) — no solo, lado direito (x = max.x + off)
  const xRight = max.x + off;
  g.add(dimLine(
    new THREE.Vector3(xRight, min.y, min.z),
    new THREE.Vector3(xRight, min.y, max.z),
    `P ${fmtDim(size.z)}`,
    labelH,
    new THREE.Vector3(off * 0.55, 0, 0),
  ));

  return g;
}

export const VIEWS = ["3d", "frente", "fundo", "esquerda", "direita", "superior", "iso"] as const;
export type ViewMode = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewMode, string> = {
  "3d": "3D",
  frente: "Frente",
  fundo: "Fundo",
  esquerda: "Esquerda",
  direita: "Direita",
  superior: "Superior",
  iso: "Isométrica",
};

export function viewDirection(view: ViewMode): THREE.Vector3 {
  switch (view) {
    case "frente":
      return new THREE.Vector3(0, 0.05, 1);
    case "fundo":
      return new THREE.Vector3(0, 0.05, -1);
    case "esquerda":
      return new THREE.Vector3(-1, 0.05, 0);
    case "direita":
      return new THREE.Vector3(1, 0.05, 0);
    case "superior":
      return new THREE.Vector3(0, 1, 0.001);
    case "iso":
      return new THREE.Vector3(1, 0.75, 1);
    default:
      return new THREE.Vector3(1, 0.6, 1.15);
  }
}
