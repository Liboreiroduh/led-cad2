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
      const mat = new THREE.MeshStandardMaterial({
        color: statusColor,
        metalness: 0.2,
        roughness: 0.35,
        transparent: true,
        opacity: status === "removed" || status === "added" ? 0.5 : 0.72,
        emissive: status && status !== "unchanged" ? STATUS_COLORS[status] : 0xf97316,
        emissiveIntensity: status && status !== "unchanged" ? 0.25 : 0.08,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(el.size_x, el.size_z, el.size_y), mat);
      mesh.position.copy(v3(el.center));
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
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
