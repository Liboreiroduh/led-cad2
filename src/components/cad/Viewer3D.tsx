"use client";

/**
 * Viewer3D — viewport Three.js com OrbitControls, vistas, seleção por raycast
 * e preview ghost (added=verde, modified=laranja, removed=vermelho).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildProjectGroup,
  buildEnvironment,
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
}

interface RefState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  bbox: THREE.Box3;
  selectionHelper: THREE.BoxHelper | null;
}

export default function Viewer3D(props: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<RefState | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const pendingDownRef = useRef<{ x: number; y: number } | null>(null);

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

    stateRef.current = { renderer, scene, camera, controls, content, bbox: new THREE.Box3(), selectionHelper: null };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

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
    const pick = (ev: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(stateRef.current!.content.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData.elementId) return obj.userData.elementId as string;
          obj = obj.parent;
        }
      }
      return null;
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
      const id = pick(ev);
      propsRef.current.onSelect(id);
    };
    const onPointerMove = (ev: PointerEvent) => {
      const id = pick(ev);
      dom.style.cursor = id ? "pointer" : "default";
    };
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointermove", onPointerMove);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", onPointerMove);
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
    const disposeGroup = (g: THREE.Group) => {
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    };
    for (const child of [...st.content.children]) {
      st.content.remove(child);
      if ((child as THREE.Group).isGroup || (child as THREE.Mesh).isMesh) disposeGroup(child as THREE.Group);
    }
    if (st.selectionHelper) {
      st.scene.remove(st.selectionHelper);
      st.selectionHelper.geometry.dispose();
      st.selectionHelper = null;
    }

    const { project, candidate, statuses, candidateStatuses } = propsRef.current;
    st.bbox.makeEmpty();

    if (candidate) {
      const oldGroup = buildProjectGroup(project, statuses);
      const newGroup = buildProjectGroup(candidate, candidateStatuses, { skipUnchanged: true });
      st.content.add(oldGroup.group);
      st.content.add(newGroup.group);
      st.bbox.expandByObject(oldGroup.group);
      st.bbox.expandByObject(newGroup.group);
    } else {
      const g = buildProjectGroup(project);
      st.content.add(g.group);
      st.bbox.expandByObject(g.group);
    }

    fitViewInternal(st, propsRef.current.viewMode);
    // reaplica highlight atual
    applyHighlightInternal(st, propsRef.current.selectedId);
  }, [props.project, props.candidate, props.statuses, props.candidateStatuses, props.fitKey]);

  // ---------- view mode ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    fitViewInternal(st, props.viewMode);
  }, [props.viewMode]);

  // ---------- selection highlight ----------
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    applyHighlightInternal(st, props.selectedId);
  }, [props.selectedId]);

  return <div ref={mountRef} className="absolute inset-0" aria-label="Viewport 3D do projeto" role="application" />;
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
    if (!mat || !("emissive" in mat)) return;
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
