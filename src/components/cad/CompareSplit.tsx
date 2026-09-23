"use client";

/**
 * CompareSplit — comparação lado-a-lado (A/B) de duas revisões.
 * Dois viewports Three.js com órbita SINCRONIZADA: girar/zoom num painel
 * replica no outro. Cores de diff: removido=vermelho (esq.), adicionado=verde
 * (dir.), modificado=laranja. Mobile: painéis empilham verticalmente.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Columns2, X, MousePointer2, Loader2 } from "lucide-react";
import { buildProjectGroup, buildEnvironment, viewDirection, type StatusMap } from "./sceneBuilder";
import type { ProjectDocument } from "@/lib/cad/schema";

export interface CompareSplitProps {
  docA: ProjectDocument;
  revA: number;
  docB: ProjectDocument;
  revB: number;
  statusesA: StatusMap;
  statusesB: StatusMap;
  diffCounts: { added: number; removed: number; modified: number };
  onClose: () => void;
}

interface PaneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  bbox: THREE.Box3;
}

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

export default function CompareSplit(props: CompareSplitProps) {
  const mountARef = useRef<HTMLDivElement>(null);
  const mountBRef = useRef<HTMLDivElement>(null);
  const stateARef = useRef<PaneState | null>(null);
  const stateBRef = useRef<PaneState | null>(null);
  const syncingRef = useRef(false);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // ---------- init dos dois painéis ----------
  useEffect(() => {
    const mountA = mountARef.current!;
    const mountB = mountBRef.current!;

    const initPane = (mount: HTMLDivElement): PaneState => {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth || 400, mount.clientHeight || 300);
      renderer.setClearColor(0xf1f3f6);
      mount.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.touchAction = "none";

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, (mount.clientWidth || 400) / (mount.clientHeight || 300), 10, 200000);
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

      const st: PaneState = { renderer, scene, camera, controls, content, bbox: new THREE.Box3() };

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
      (st as PaneState & { ro?: ResizeObserver }).ro = ro;
      return st;
    };

    const a = initPane(mountA);
    const b = initPane(mountB);
    stateARef.current = a;
    stateBRef.current = b;

    // órbita sincronizada: câmera/target copiados com guard anti-loop
    const syncFrom = (from: PaneState, to: PaneState) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      to.camera.position.copy(from.camera.position);
      to.controls.target.copy(from.controls.target);
      to.controls.update();
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    const onChangeA = () => stateBRef.current && syncFrom(a, stateBRef.current);
    const onChangeB = () => stateARef.current && syncFrom(b, stateARef.current);
    a.controls.addEventListener("change", onChangeA);
    b.controls.addEventListener("change", onChangeB);
    (a as PaneState & { onChange?: () => void }).onChange = onChangeA;
    (b as PaneState & { onChange?: () => void }).onChange = onChangeB;

    return () => {
      for (const st of [stateARef.current, stateBRef.current]) {
        if (!st) continue;
        const ro = (st as PaneState & { ro?: ResizeObserver }).ro;
        ro?.disconnect();
        const onChange = (st as PaneState & { onChange?: () => void }).onChange;
        if (onChange) st.controls.removeEventListener("change", onChange);
        st.controls.dispose();
        st.renderer.dispose();
        st.renderer.domElement.parentElement?.removeChild(st.renderer.domElement);
        disposeDeep(st.content);
      }
      stateARef.current = null;
      stateBRef.current = null;
    };
  }, []);

  // ---------- rebuild conteúdo quando documentos mudam ----------
  useEffect(() => {
    const { docA, docB, statusesA, statusesB } = propsRef.current;
    const fillPane = (st: PaneState | null, doc: ProjectDocument, statuses: StatusMap) => {
      if (!st) return;
      for (const child of [...st.content.children]) {
        st.content.remove(child);
        disposeDeep(child);
      }
      st.bbox.makeEmpty();
      const g = buildProjectGroup(doc, statuses);
      st.content.add(g.group);
      st.bbox.expandByObject(g.group);
      // enquadra isométrico
      if (!st.bbox.isEmpty()) {
        const center = st.bbox.getCenter(new THREE.Vector3());
        const size = st.bbox.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 1500);
        const dir = viewDirection("iso").normalize();
        const dist = (radius / Math.sin((st.camera.fov * Math.PI) / 360)) * 1.12;
        st.camera.position.copy(center).add(dir.multiplyScalar(dist));
        st.camera.near = Math.max(dist / 100, 1);
        st.camera.far = dist * 40;
        st.camera.updateProjectionMatrix();
        st.controls.target.copy(center);
        st.controls.update();
      }
    };
    fillPane(stateARef.current, docA, statusesA);
    fillPane(stateBRef.current, docB, statusesB);
  }, [props.docA, props.docB, props.statusesA, props.statusesB]);

  const { revA, revB, diffCounts } = props;
  const elementsA = props.docA.elements.length;
  const elementsB = props.docB.elements.length;

  return (
    <div className="absolute inset-0 z-[15] flex flex-col lg:flex-row gap-1.5 p-1.5 bg-slate-200/60 backdrop-blur-[2px]" role="region" aria-label="Comparação lado a lado entre revisões">
      {/* PAINEL A — documento atual */}
      <Pane
        mountRef={mountARef}
        side="A"
        tint="border-t-rose-500"
        title={`ATUAL · rev ${revA}`}
        badge={`${elementsA} el.`}
        accentText="text-rose-700"
      />

      {/* divisor central com rótulo */}
      <div className="hidden lg:flex flex-col items-center justify-center gap-1 w-8 shrink-0" aria-hidden>
        <div className="flex-1 w-px bg-slate-300" />
        <span className="rotate-90 whitespace-nowrap text-[10px] font-bold tracking-widest text-slate-500">VS</span>
        <div className="flex-1 w-px bg-slate-300" />
      </div>

      {/* PAINEL B — revisão comparada */}
      <Pane
        mountRef={mountBRef}
        side="B"
        tint="border-t-emerald-500"
        title={`REV ${revB} · restaurável`}
        badge={`${elementsB} el.`}
        accentText="text-emerald-700"
      />

      {/* cabeçalho flutuante */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#1b2836]/95 backdrop-blur text-white rounded-full pl-3 pr-1.5 py-1.5 shadow-xl border border-slate-600/60 z-10 whitespace-nowrap max-w-[calc(100%-16px)]">
        <Columns2 className="h-4 w-4 text-orange-400 shrink-0" aria-hidden />
        <span className="text-[11px] font-bold tracking-wide whitespace-nowrap">
          COMPARAÇÃO A/B · rev {revA} <span className="text-slate-400">vs</span> rev {revB}
        </span>
        <span className="hidden md:inline text-[10px] font-semibold text-slate-300 border-l border-slate-600 pl-2 ml-0.5 whitespace-nowrap">
          <span className="text-emerald-400">+{diffCounts.added}</span> <span className="text-orange-400">~{diffCounts.modified}</span>{" "}
          <span className="text-rose-400">-{diffCounts.removed}</span>
        </span>
        <span className="hidden lg:flex items-center gap-1 text-[10px] text-slate-300 border-l border-slate-600 pl-2 ml-1 whitespace-nowrap">
          <MousePointer2 className="h-3 w-3" /> órbita sincronizada
        </span>
        <button
          onClick={props.onClose}
          className="h-6 w-6 grid place-items-center rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          aria-label="Fechar comparação A/B"
          title="Fechar comparação A/B (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------- painel individual ------------------------- */

function Pane({
  mountRef,
  side,
  title,
  badge,
  tint,
  accentText,
}: {
  mountRef: React.RefObject<HTMLDivElement | null>;
  side: "A" | "B";
  title: string;
  badge: string;
  tint: string;
  accentText: string;
}) {
  return (
    <div className={`relative flex-1 min-w-0 min-h-0 rounded-xl overflow-hidden border border-slate-300 shadow-lg bg-slate-100 border-t-4 ${tint}`}>
      <div ref={mountRef} className="absolute inset-0" aria-label={`Viewport 3D ${side}`} role="application" />
      <div className={`absolute top-2 left-2 flex items-center gap-1.5 bg-white/92 backdrop-blur rounded-lg px-2 py-1 shadow border border-slate-200 pointer-events-none`}>
        <span className={`text-[10px] font-black grid place-items-center h-4.5 w-4.5 px-1 rounded ${side === "A" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`} aria-hidden>
          {side}
        </span>
        <span className={`text-[11px] font-bold ${accentText}`}>{title}</span>
        <span className="text-[10px] text-slate-500">{badge}</span>
      </div>
      {/* fallback de load (canvas monta de imediato — loader só para SSR flash) */}
      <div className="absolute inset-0 grid place-items-center text-slate-300 pointer-events-none" aria-hidden>
        <Loader2 className="h-5 w-5 animate-spin opacity-0" />
      </div>
    </div>
  );
}
