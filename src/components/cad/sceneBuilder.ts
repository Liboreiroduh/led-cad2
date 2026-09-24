/**
 * Scene builder v2 — converte GeometryDocument em geometria Three.js.
 * O renderer decide por element.geometry.type (NUNCA por role/profile/material).
 * Mapeamento: model(X=largura, Y=profundidade, Z=altura) → three(x, y=altura, z=profundidade).
 * Estados de diff: added=verde, modified=laranja, removed=vermelho (ghost), unchanged=cinza.
 */
import * as THREE from "three";
import type { ProjectDocument, GeometryElement, Geometry } from "@/lib/cad/schema";
import { elLed } from "@/lib/cad/schema";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";
export type StatusMap = Record<string, DiffStatus>;

export const STATUS_COLORS: Record<DiffStatus, number> = {
  added: 0x16a34a,
  removed: 0xdc2626,
  modified: 0xea580c,
  unchanged: 0x64748b,
};

/* ==================== HIERARQUIA DE TRAÇOS (desenho técnico 3D) ====================
 * 1) SILHUETA  — contorno externo forte (inverted hull, cinza escuro)
 * 2) ARESTAS   — quinas/mudanças de plano reais (EdgesGeometry, cinza médio)
 * 3) INTERNO   — triangulação leve de superfícies livres (cinza claro)
 * Preenchimentos claros e flat shading: nada de massa escura dominando.
 */
const EDGE_DARK = 0x272d34; // silhueta (traço mais forte)
const EDGE_MED = 0x4d555f; // arestas de recurso (traço médio)
const EDGE_SOFT = 0xb6bdc5; // traços internos (mais leves)
const EDGE_HIDDEN = 0xbfc6ce; // arestas ocultas (tracejadas, discretas)

const STEEL = 0xe9edf1; // preenchimento quase branco (membros)
const PANEL = 0x1f2937;

/** Clareia uma cor misturando com branco — evita superfícies escuras dominando. */
function lighten(color: number, amt = 0.4): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

const _silhouetteMat = new THREE.MeshBasicMaterial({ color: EDGE_DARK, side: THREE.BackSide });

/**
 * Infla o mesh ~1,5% com material BackSide escuro → contorno de silhueta
 * legível de qualquer ângulo (o clássico "inverted hull" de desenho técnico).
 * Funciona com geometria centrada na origem OU com coordenadas absolutas
 * (infla em torno do centro da bounding sphere).
 */
function addSilhouette(host: THREE.Object3D, geo: THREE.BufferGeometry, scale = 1.018): void {
  geo.computeBoundingSphere();
  const c = geo.boundingSphere?.center;
  const hull = new THREE.Mesh(geo, _silhouetteMat);
  if (c && (Math.abs(c.x) > 1e-6 || Math.abs(c.y) > 1e-6 || Math.abs(c.z) > 1e-6)) {
    hull.position.set(c.x * (1 - scale), c.y * (1 - scale), c.z * (1 - scale));
  }
  hull.scale.setScalar(scale);
  hull.userData.elementId = host.userData.elementId;
  host.add(hull);
}

/**
 * Traços técnicos sobre um volume:
 *  - arestas de recurso (quinas/mudanças de plano acima de featureThreshold graus)
 *  - malha interna leve (triangulação) para geometrias livres, com teto de triângulos
 */
function addTechLines(
  host: THREE.Object3D,
  geo: THREE.BufferGeometry,
  opts: { featureThreshold?: number; innerWireframe?: boolean; edgeColor?: number; edgeOpacity?: number; hidden?: boolean; wireCap?: number } = {},
): void {
  const {
    featureThreshold = 25,
    innerWireframe = false,
    edgeColor = EDGE_MED,
    edgeOpacity = 0.95,
    hidden = false,
    wireCap = 4000,
  } = opts;
  const id = host.userData.elementId as string | undefined;
  const tag = (o: THREE.Object3D) => {
    if (id) o.userData.elementId = id;
    host.add(o);
  };

  geo.computeBoundingSphere();
  const radius = geo.boundingSphere?.radius ?? 1000;

  // ARESTAS OCULTAS — tracejadas, sem depth test, discretas; só em geometrias pequenas/médias
  // (meshes grandes ficam ruidosas — nelas só as arestas de recurso existem)
  if (hidden) {
    const tris = geo.index ? geo.index.count / 3 : (geo.getAttribute("position")?.count ?? 0) / 3;
    if (tris <= 4000) {
      const useThreshold = Math.min(featureThreshold, 14);
      const dashed = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, useThreshold),
        new THREE.LineDashedMaterial({
          color: EDGE_HIDDEN,
          transparent: true,
          opacity: 0.3,
          depthTest: false,
          dashSize: Math.min(Math.max(radius * 0.02, 8), 90),
          gapSize: Math.min(Math.max(radius * 0.013, 5), 60),
        }),
      );
      dashed.computeLineDistances();
      dashed.renderOrder = 1;
      tag(dashed);
    }
  }

  // ARESTAS DE RECURSO — quinas/mudanças de plano (visíveis, traço médio)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, featureThreshold),
    new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: edgeOpacity }),
  );
  edges.renderOrder = 2;
  tag(edges);

  // TRAÇOS INTERNOS — triangulação leve (superfícies livres)
  if (innerWireframe) {
    const pos = geo.getAttribute("position");
    const tris = geo.index ? geo.index.count / 3 : pos ? pos.count / 3 : 0;
    if (tris > 0 && tris <= wireCap) {
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: EDGE_SOFT, transparent: true, opacity: 0.2 }),
      );
      wire.renderOrder = 2;
      tag(wire);
    }
  }
}

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

/* ============================ CORES BASE POR PRIMITIVO ============================ */

const BASE_COLORS: Record<string, number> = {
  line: 0xb3bbc4,
  beam: STEEL,
  box: 0xecf0f3,
  cylinder: STEEL,
  circle: 0x99a2ac,
  arc: 0x99a2ac,
  polyline: 0xb3bbc4,
  polygon: 0xf2f4f7,
  surface: 0xf2f4f7,
  mesh: 0xf2f4f7,
  text: 0x475569,
  dimension: 0x475569,
};

/** Cor do elemento: metadata.color (#rrggbb, clareada p/ não dominar) → paleta → status de diff. */
function baseColor(el: GeometryElement, status?: DiffStatus): number {
  if (status && status !== "unchanged") return STATUS_COLORS[status];
  const c = el.metadata?.["color"];
  if (typeof c === "string") {
    const m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) return lighten(parseInt(m[1], 16));
  }
  if (elLed(el)) return PANEL;
  return BASE_COLORS[el.geometry.type] ?? STEEL;
}

/** Plano (XY|XZ|YZ do modelo) → função que mapeia um ponto 2D do plano para o espaço modelo. */
function planeBasis(plane: string): ((u: number, v: number) => { x: number; y: number; z: number }) {
  if (plane === "XY") return (u, v) => ({ x: u, y: v, z: 0 });
  if (plane === "YZ") return (u, v) => ({ x: 0, y: u, z: v });
  return (u, v) => ({ x: u, y: 0, z: v }); // XZ (vertical, padrão para círculos "de pé")
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

  // material de volume: claro, fosco e flat — mudanças de plano ficam visíveis
  const mkSteel = (color: number, status?: DiffStatus, opacity = 1) =>
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.06,
      roughness: 0.9,
      flatShading: true,
      transparent: opacity < 1 || (status !== undefined && status !== "unchanged"),
      opacity: status === "added" || status === "removed" ? 0.55 : status === "modified" ? 0.8 : opacity,
      emissive: status && status !== "unchanged" ? STATUS_COLORS[status] : 0x000000,
      emissiveIntensity: status && status !== "unchanged" ? 0.18 : 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

  const bbox = new THREE.Box3();
  const addMesh = (el: GeometryElement, mesh: THREE.Object3D) => {
    const status = statuses?.[el.id];
    register(el.id, mesh);
    group.add(mesh);
    bbox.expandByObject(mesh);
    void status;
  };

  for (const el of doc.elements) {
    const status = statuses?.[el.id];
    if (status === "unchanged" && opts.skipUnchanged) continue;
    const color = baseColor(el, status);
    const g = el.geometry;

    switch (g.type) {
      case "beam": {
        const w = g.section.width;
        const h = g.section.height;
        const a = v3(g.start);
        const b = v3(g.end);
        const mesh =
          g.section.type === "round"
            ? orientedMesh(a, b, (len) => new THREE.CylinderGeometry(g.section.diameter / 2, g.section.diameter / 2, len, 20), new THREE.Vector3(0, 1, 0))
            : orientedMesh(a, b, (len) => new THREE.BoxGeometry(w, h, len), new THREE.Vector3(0, 0, 1));
        mesh.material = mkSteel(color, status);
        addMesh(el, mesh);
        addSilhouette(mesh, mesh.geometry);
        addTechLines(mesh, mesh.geometry, { featureThreshold: g.section.type === "round" ? 30 : 1 });
        break;
      }
      case "cylinder": {
        const mesh = orientedMesh(
          v3(g.start),
          v3(g.end),
          (len) => new THREE.CylinderGeometry(g.diameter / 2, g.diameter / 2, len, 20),
          new THREE.Vector3(0, 1, 0),
        );
        mesh.material = mkSteel(color, status);
        addMesh(el, mesh);
        addSilhouette(mesh, mesh.geometry);
        addTechLines(mesh, mesh.geometry, { featureThreshold: 30 });
        break;
      }
      case "line": {
        const t = Math.max(g.thickness ?? 8, 2);
        const mesh = orientedMesh(
          v3(g.start),
          v3(g.end),
          (len) => new THREE.CylinderGeometry(t / 2, t / 2, len, 8),
          new THREE.Vector3(0, 1, 0),
        );
        mesh.material = mkSteel(color, status);
        addMesh(el, mesh);
        break;
      }
      case "polyline": {
        const t = Math.max(g.thickness ?? 8, 2);
        const pts = g.points.map((p) => v3(p));
        if (g.closed && pts.length > 2) pts.push(pts[0].clone());
        const polylineGroup = new THREE.Group();
        for (let i = 1; i < pts.length; i++) {
          const seg = orientedMesh(pts[i - 1], pts[i], (len) => new THREE.CylinderGeometry(t / 2, t / 2, len, 8), new THREE.Vector3(0, 1, 0));
          seg.material = mkSteel(color, status);
          addSilhouette(seg, seg.geometry);
          polylineGroup.add(seg);
        }
        polylineGroup.userData.elementId = el.id;
        addMesh(el, polylineGroup);
        break;
      }
      case "box": {
        const [sx, sy, sz] = g.size;
        const isLed = elLed(el);
        if (isLed) {
          // face frontal (three +Z) recebe a textura de módulos LED
          const baseMat = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.2,
            roughness: 0.35,
            transparent: true,
            opacity: status === "removed" || status === "added" ? 0.5 : 0.72,
            emissive: status && status !== "unchanged" ? STATUS_COLORS[status] : 0xf97316,
            emissiveIntensity: status && status !== "unchanged" ? 0.25 : 0.08,
            side: THREE.DoubleSide,
          });
          const frontMat = baseMat.clone();
          frontMat.map = panelTexture();
          frontMat.emissiveMap = panelTexture();
          frontMat.emissive = new THREE.Color(0xffffff);
          frontMat.emissiveIntensity = status && status !== "unchanged" ? 0.35 : 0.5;
          const geo = new THREE.BoxGeometry(sx, sz, sy);
          const mesh = new THREE.Mesh(geo, [baseMat, baseMat, baseMat, baseMat, frontMat, baseMat]);
          mesh.position.copy(v3(g.center));
          if (g.rotation) {
            const [rx, ry, rz] = g.rotation.map(THREE.MathUtils.degToRad);
            mesh.rotation.set(rx, rz, ry); // model Y (prof.) → three Z; model Z (alt.) → three Y
          }
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55 }),
          );
          mesh.add(edges);
          register(el.id, edges);
          addMesh(el, mesh);
          addSilhouette(mesh, geo);
        } else {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sz, sy), mkSteel(color, status));
          mesh.position.copy(v3(g.center));
          if (g.rotation) {
            const [rx, ry, rz] = g.rotation.map(THREE.MathUtils.degToRad);
            mesh.rotation.set(rx, rz, ry);
          }
          addMesh(el, mesh);
          // caixa: silhueta forte + 12 arestas visíveis + as mesmas em tracejado (hidden) — leitura "enxergando através"
          addSilhouette(mesh, mesh.geometry);
          addTechLines(mesh, mesh.geometry, { featureThreshold: 1, hidden: true });
        }
        break;
      }
      case "circle": {
        const basis = planeBasis(g.plane ?? "XY");
        const segs = 64;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const p = basis(g.center.x + g.radius * Math.cos(a), g.center.y + g.radius * Math.sin(a));
          pts.push(v3(p));
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
        addMesh(el, line);
        break;
      }
      case "arc": {
        const basis = planeBasis(g.plane ?? "XY");
        const span = g.end_angle - g.start_angle;
        const segs = Math.max(8, Math.min(96, Math.ceil(Math.abs(span) / 4)));
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segs; i++) {
          const a = THREE.MathUtils.degToRad(g.start_angle + (span * i) / segs);
          const p = basis(g.center.x + g.radius * Math.cos(a), g.center.y + g.radius * Math.sin(a));
          pts.push(v3(p));
        }
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        const t = g.thickness;
        if (t && t > 4) {
          // arco com espessura → tubos por segmento
          const arcGroup = new THREE.Group();
          for (let i = 1; i < pts.length; i++) {
            const seg = orientedMesh(pts[i - 1], pts[i], (len) => new THREE.CylinderGeometry(t / 2, t / 2, len, 8), new THREE.Vector3(0, 1, 0));
            seg.material = mkSteel(color, status);
            addSilhouette(seg, seg.geometry);
            arcGroup.add(seg);
          }
          arcGroup.userData.elementId = el.id;
          addMesh(el, arcGroup);
        } else {
          addMesh(el, line);
        }
        break;
      }
      case "polygon":
      case "surface": {
        const geometry = new THREE.BufferGeometry();
        const pts = g.points.map((p) => v3(p));
        const vertices: number[] = [];
        for (let i = 1; i < pts.length - 1; i++) {
          vertices.push(pts[0].x, pts[0].y, pts[0].z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, mkSteel(color, status, 0.85));
        addMesh(el, mesh);
        // superfície plana: contorno forte + vincos sutis + triangulação interna + ocultas tracejadas
        addSilhouette(mesh, geometry);
        addTechLines(mesh, geometry, { featureThreshold: 18, innerWireframe: true, hidden: true });
        break;
      }
      case "mesh": {
        const geometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        for (const face of g.faces) {
          const idx = face.map((i) => g.vertices[i]).filter(Boolean);
          if (idx.length < 3) continue;
          for (let i = 1; i < idx.length - 1; i++) {
            for (const p of [idx[0], idx[i], idx[i + 1]]) {
              vertices.push(p.x, p.z, p.y);
            }
          }
        }
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, mkSteel(color, status, 0.9));
        addMesh(el, mesh);
        // malha livre: silhueta + dobras reais + triangulação leve + ocultas tracejadas
        addSilhouette(mesh, geometry);
        addTechLines(mesh, geometry, { featureThreshold: 18, innerWireframe: true, hidden: true });
        break;
      }
      case "text": {
        const height = g.height ?? 120;
        const sprite = labelSprite(g.text, height);
        sprite.position.copy(v3(g.position));
        addMesh(el, sprite);
        break;
      }
      case "dimension": {
        const A = v3(g.start);
        const B = v3(g.end);
        const len = A.distanceTo(B);
        // cota proporcional e PERTO do trecho medido — ancorada na geometria
        const labelH = Math.min(Math.max(len * 0.06, 25), 260);
        const off = Math.min(Math.max(len * 0.05, 25), 220);
        const dimGroup = dimLine(A, B, g.text ?? `${Math.round(len)} mm`, labelH, new THREE.Vector3(0, 0, off));
        dimGroup.userData.elementId = el.id;
        addMesh(el, dimGroup);
        break;
      }
      default:
        break;
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
  const lineMat = new THREE.LineBasicMaterial({ color: DIM_COLOR, transparent: true, opacity: 0.75 });
  const accentMat = new THREE.LineBasicMaterial({ color: DIM_ACCENT });

  // COTA ANCORADA: linha de cota PARALELA deslocada da geometria, com linhas de
  // extensão ligando os pontos medidos até a cota (padrão de desenho técnico).
  const a2 = a.clone().add(labelOffset);
  const b2 = b.clone().add(labelOffset);

  // linhas de extensão: do ponto medido até um pouco além da linha de cota
  const over = labelOffset.clone().multiplyScalar(1.22);
  for (const p of [a, b]) {
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, p.clone().add(over)]), lineMat));
  }

  // ticks nos pontos medidos (ancoragem visual na geometria)
  for (const p of [a, b]) {
    const tick = new THREE.Mesh(
      new THREE.SphereGeometry(labelH * 0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: DIM_ACCENT }),
    );
    tick.position.copy(p);
    g.add(tick);
  }

  // linha de cota deslocada
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a2, b2]), accentMat));

  // setas (cones) nas pontas da linha deslocada
  const arrowLen = labelH * 0.45;
  const arrowGeo = new THREE.ConeGeometry(arrowLen * 0.35, arrowLen, 10);
  for (const [tip, from] of [[a2, b2], [b2, a2]] as const) {
    const cone = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: DIM_ACCENT }));
    const d = new THREE.Vector3().subVectors(tip, from).normalize();
    cone.position.copy(tip).sub(d.clone().multiplyScalar(arrowLen * 0.5));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    g.add(cone);
  }

  // rótulo acima do meio da linha de cota deslocada
  const label = labelSprite(text, labelH);
  label.position.copy(a2).add(b2).multiplyScalar(0.5).add(new THREE.Vector3(0, labelH * 0.6, 0));
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
  const off = diag * 0.045;
  const labelH = Math.max(diag * 0.03, 40);
  const g = new THREE.Group();
  g.name = "dimensions";

  // LARGURA X — na frente (z = max.z + off), ao nível do solo (y = min.y)
  const zFront = max.z + off;
  g.add(dimLine(
    new THREE.Vector3(min.x, min.y, zFront),
    new THREE.Vector3(max.x, min.y, zFront),
    `L ${fmtDim(size.x)}`,
    labelH,
    new THREE.Vector3(0, 0, off * 0.38),
   ));

  // ALTURA Y (Z do modelo) — no canto esquerdo (x = min.x - off, z = min.z)
  const xLeft = min.x - off;
  g.add(dimLine(
    new THREE.Vector3(xLeft, min.y, min.z),
    new THREE.Vector3(xLeft, max.y, min.z),
    `H ${fmtDim(size.y)}`,
    labelH,
    new THREE.Vector3(-off * 0.38, 0, 0),
   ));

  // PROFUNDIDADE Z (Y do modelo) — no solo, lado direito (x = max.x + off)
  const xRight = max.x + off;
  g.add(dimLine(
    new THREE.Vector3(xRight, min.y, min.z),
    new THREE.Vector3(xRight, min.y, max.z),
    `P ${fmtDim(size.z)}`,
    labelH,
    new THREE.Vector3(off * 0.38, 0, 0),
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
