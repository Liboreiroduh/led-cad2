"use client";

/**
 * Viewer3D — viewport Three.js com OrbitControls, vistas, seleção por raycast,
 * preview ghost (added=verde, modified=laranja, removed=vermelho),
 * cotas de envelope (L/H/P) e ferramenta de medição de distâncias.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildProjectGroup,
  buildEnvironment,
  buildDimensionGroup,
  viewDirection,
  STATUS_COLORS,
  type StatusMap,
  type ViewMode,
} from "./sceneBuilder";
import type { ProjectDocument } from "@/lib/cad/schema";

export interface Viewer3DProps {
  project: ProjectDocument;
  candidate: ProjectDocument | null;
  statuses: StatusMap;
  candidateStatuses: StatusMap;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: ViewMode;
  fitKey: string;
  /** ids ocultos (controle de visibilidade por elemento) */
  hiddenIds?: Set<string>;
  /** requisição de foco: { id, nonce } — enquadra a câmera no elemento */
  focusRequest?: { id: string; nonce: number } | null;
  /** nonce > 0 dispara download de PNG do viewport */
  snapshotSignal?: number;
  /** exibir cotas de envelope (largura/altura/profundidade) */
  showDimensions?: boolean;
  /** modo medição: cliques no modelo marcam pontos e mostram distância */
  measureMode?: boolean;
  /** resultado da última medição (limpo com null) */
  onMeasureResult?: (r: { distance: number } | null) => void;
  /** pausa o loop de render (usado na comparação A/B p/ liberar GPU) */
  paused?: boolean;
}

interface RefState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  bbox: THREE.Box3;
  selectionHelper: THREE.BoxHelper | null;
  byId: Map<string, THREE.Object3D[]>;
  dims: THREE.Group | null;
  measure: THREE.Group | null;
  measurePoints: THREE.Vector3[];
}

const MEASURE_COLOR = 0xea580c;

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh.material as THREE.Material | THREE.Material[] | undefined);
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
    const spr = o as THREE.Sprite;
    if (spr.isSprite) spr.material.map?.dispose();
  });
}

export default function Viewer3D(props: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<RefState | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const pendingDownRef = useRef<{ x: number; y: number } | null>(null);
  // incrementado quando o contexto WebGL é restaurado — força rebuild do conteúdo
  const [ctxEpoch, setCtxEpoch] = useState(0);

  // ---------- init ----------
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0xf1f3f6);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 10, 200000);
    camera.position.set(9000, 6500, 10500);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x94a0ae, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(1, 1.7, 0.9).multiplyScalar(20000);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdde6f0, 0.55);
    fill.position.set(-1, 0.7, -0.8).multiplyScalar(20000);
    scene.add(fill);

    scene.add(buildEnvironment());

    const content = new THREE.Group();
    scene.add(content);

    stateRef.current = {
      renderer, scene, camera, controls, content,
      bbox: new THREE.Box3(), selectionHelper: null, byId: new Map(),
      dims: null, measure: null, measurePoints: [],
    };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (propsRef.current.paused) return; // economiza GPU enquanto A/B ativo
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // recuperação de perda de contexto WebGL (ex.: muitos viewports ativos)
    const onContextLost = (ev: Event) => {
      ev.preventDefault(); // permite o browser restaurar depois
      console.warn("[Viewer3D] WebGL context lost — aguardando restore");
    };
    const onContextRestored = () => {
      console.warn("[Viewer3D] WebGL context restored");
      setCtxEpoch((n) => n + 1); // força rebuild do conteúdo
    };

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (ev: PointerEvent): { id: string | null; point: THREE.Vector3 | null } => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(stateRef.current!.content.children, true)
        .filter((h) => h.object.visible);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData.elementId) return { id: obj.userData.elementId as string, point: hit.point.clone() };
          obj = obj.parent;
        }
      }
      return { id: null, point: hits[0]?.point.clone() ?? null };
    };

    const dom = renderer.domElement;
    const onPointerDown = (ev: PointerEvent) => {
      pendingDownRef.current = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      const down = pendingDownRef.current;
      pendingDownRef.current = null;
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      if (moved > 5) return;
      const { id, point } = pick(ev);
      if (propsRef.current.measureMode) {
        if (point) addMeasurePoint(stateRef.current!, point, propsRef.current.onMeasureResult);
        return; // em modo medição o clique não seleciona
      }
      propsRef.current.onSelect(id);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (propsRef.current.measureMode) {
        dom.style.cursor = "crosshair";
        return;
      }
      const { id } = pick(ev);
      dom.style.cursor = id ? "pointer" : "default";
    };
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("webglcontextlost", onContextLost);
    dom.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("webglcontextlost", onContextLost);
      dom.removeEventListener("webglcontextrestored", onContextRestored);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(dom);
      stateRef.current = null;
    };
  }, []);

  // ---------- rebuild content ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    // limpa conteúdo anterior (dispose de geometrias)
    for (const child of [...st.content.children]) {
      st.content.remove(child);
      disposeDeep(child);
    }
    if (st.selectionHelper) {
      st.scene.remove(st.selectionHelper);
      st.selectionHelper.geometry.dispose();
      st.selectionHelper = null;
    }
    // medição perde sentido após rebuild
    clearMeasure(st, propsRef.current.onMeasureResult);

    const { project, candidate, statuses, candidateStatuses, hiddenIds } = propsRef.current;
    st.bbox.makeEmpty();
    st.byId = new Map();

    if (candidate) {
      const oldGroup = buildProjectGroup(project, statuses);
      const newGroup = buildProjectGroup(candidate, candidateStatuses, { skipUnchanged: true });
      st.content.add(oldGroup.group);
      st.content.add(newGroup.group);
      for (const [k, v] of oldGroup.byId) st.byId.set(k, v);
      for (const [k, v] of newGroup.byId) st.byId.set(k, [...(st.byId.get(k) ?? []), ...v]);
      st.bbox.expandByObject(oldGroup.group);
      st.bbox.expandByObject(newGroup.group);
    } else {
      const g = buildProjectGroup(project);
      st.content.add(g.group);
      for (const [k, v] of g.byId) st.byId.set(k, v);
      st.bbox.expandByObject(g.group);
    }

    applyVisibility(st, hiddenIds);
    rebuildDims(st, propsRef.current.showDimensions);
    fitViewInternal(st, propsRef.current.viewMode);
    // reaplica highlight atual
    applyHighlightInternal(st, propsRef.current.selectedId);
  }, [props.project, props.candidate, props.statuses, props.candidateStatuses, props.fitKey, ctxEpoch]);

  // ---------- cotas toggle ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    rebuildDims(st, props.showDimensions);
  }, [props.showDimensions]);

  // ---------- view mode ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    fitViewInternal(st, props.viewMode);
  }, [props.viewMode]);

  // ---------- measure mode off → limpa ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    if (!props.measureMode) clearMeasure(st, props.onMeasureResult);
  }, [props.measureMode]);

  // ---------- selection highlight ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    applyHighlightInternal(st, props.selectedId);
  }, [props.selectedId]);

  // ---------- visibility (hidden ids) ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    applyVisibility(st, props.hiddenIds);
  }, [props.hiddenIds]);

  // ---------- focus element ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !props.focusRequest) return;
    const objs = st.byId.get(props.focusRequest.id);
    if (!objs?.length) return;
    const box = new THREE.Box3();
    for (const o of objs) {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) box.expandByObject(o);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 400);
    const dir = st.camera.position.clone().sub(st.controls.target).normalize();
    const dist = (radius / Math.sin((st.camera.fov * Math.PI) / 360)) * 1.4;
    st.camera.position.copy(center).add(dir.multiplyScalar(dist));
    st.controls.target.copy(center);
    st.controls.update();
  }, [props.focusRequest?.nonce]);

  // ---------- snapshot PNG ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !props.snapshotSignal) return;
    st.renderer.render(st.scene, st.camera);
    const url = st.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `led-cad-3d-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [props.snapshotSignal]);

  return <div ref={mountRef} className="absolute inset-0" aria-label="Viewport 3D do projeto" role="application" />;
}

/* ------------------------- cotas ------------------------- */

function rebuildDims(st: RefState, show: boolean | undefined): void {
  if (st.dims) {
    st.scene.remove(st.dims);
    disposeDeep(st.dims);
    st.dims = null;
  }
  if (!show) return;
  const g = buildDimensionGroup(st.bbox);
  if (!g) return;
  st.scene.add(g);
  st.dims = g;
}

/* ------------------------- medição ------------------------- */

function measureLabelSprite(text: string, worldHeight: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(234,88,12,0.95)";
  g.beginPath();
  g.roundRect(6, 14, c.width - 12, c.height - 28, 24);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "bold 64px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(worldHeight * 4, worldHeight, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

function fmtMeasure(mm: number): string {
  return `${Math.round(mm)} mm${mm >= 1000 ? ` (${(mm / 1000).toFixed(3)} m)` : ""}`;
}

function clearMeasure(st: RefState, onMeasureResult?: (r: { distance: number } | null) => void): void {
  if (st.measure) {
    st.scene.remove(st.measure);
    disposeDeep(st.measure);
    st.measure = null;
  }
  st.measurePoints = [];
  onMeasureResult?.(null);
}

function addMeasurePoint(
  st: RefState,
  point: THREE.Vector3,
  onMeasureResult?: (r: { distance: number } | null) => void,
): void {
  const diag = st.bbox.isEmpty() ? 5000 : st.bbox.getSize(new THREE.Vector3()).length();
  const markerR = Math.max(diag * 0.012, 12);

  // reinicia se já havia 2 pontos
  if (st.measurePoints.length >= 2) {
    if (st.measure) {
      st.scene.remove(st.measure);
      disposeDeep(st.measure);
      st.measure = null;
    }
    st.measurePoints = [];
    onMeasureResult?.(null);
  }

  st.measurePoints.push(point.clone());

  if (!st.measure) {
    st.measure = new THREE.Group();
    st.measure.name = "measure";
    st.scene.add(st.measure);
  }

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(markerR, 16, 16),
    new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  marker.renderOrder = 998;
  marker.position.copy(point);
  st.measure.add(marker);

  if (st.measurePoints.length === 2) {
    const [a, b] = st.measurePoints;
    const dist = a.distanceTo(b);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: MEASURE_COLOR, depthTest: false }),
    );
    line.renderOrder = 998;
    st.measure.add(line);
    const label = measureLabelSprite(fmtMeasure(dist), Math.max(diag * 0.03, 36));
    label.position.copy(a).add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, diag * 0.03, 0));
    st.measure.add(label);
    onMeasureResult?.({ distance: dist });
  }
}

/* ------------------------- helpers ------------------------- */

function applyVisibility(st: RefState, hiddenIds?: Set<string>): void {
  for (const [, objs] of st.byId) {
    for (const o of objs) {
      const visible = !(hiddenIds?.has(o.userData.elementId as string) ?? false);
      o.visible = visible;
      o.traverse((c) => {
        c.visible = visible;
      });
    }
  }
}

function fitViewInternal(st: RefState, view: ViewMode): void {
  const bbox = st.bbox;
  if (bbox.isEmpty()) return;
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1500);
  const dir = viewDirection(view).normalize();
  const dist = (radius / Math.sin((st.camera.fov * Math.PI) / 360)) * 1.12;
  st.camera.position.copy(center).add(dir.multiplyScalar(dist));
  st.camera.near = Math.max(dist / 100, 1);
  st.camera.far = dist * 40;
  st.camera.updateProjectionMatrix();
  st.controls.target.copy(center);
  st.controls.update();
}

function applyHighlightInternal(st: RefState, selectedId: string | null): void {
  const { content } = st;
  content.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || !("emissive" in mat) || Array.isArray(mesh.material)) return;
    if (mesh.userData._baseEmissive === undefined) {
      mesh.userData._baseEmissive = mat.emissive.getHex();
      mesh.userData._baseIntensity = mat.emissiveIntensity;
    }
    mat.emissive.setHex(mesh.userData._baseEmissive as number);
    mat.emissiveIntensity = mesh.userData._baseIntensity as number;
  });

  if (st.selectionHelper) {
    st.scene.remove(st.selectionHelper);
    st.selectionHelper.geometry.dispose();
    st.selectionHelper = null;
  }
  if (!selectedId) return;

  const targets: THREE.Object3D[] = [];
  content.traverse((o) => {
    if (o.userData.elementId === selectedId) targets.push(o);
  });
  for (const obj of targets) {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && "emissive" in mat) {
        mat.emissive.setHex(0xf97316);
        mat.emissiveIntensity = 0.5;
      }
    }
  }
  if (targets.length) {
    const helper = new THREE.BoxHelper(targets[0], STATUS_COLORS.modified);
    (helper.material as THREE.LineBasicMaterial).transparent = true;
    (helper.material as THREE.LineBasicMaterial).opacity = 0.9;
    st.scene.add(helper);
    st.selectionHelper = helper;
  }
}
