"use client";

/**
 * LED JSON CAD — página principal.
 * JSON do projeto é a autoridade; canvas é visualização; IA transforma documentos;
 * diff calculado pelo sistema; preview antes de apply; undo por snapshot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  FilePlus2, Upload, Undo2, FileSpreadsheet, FileDown, PlugZap, Loader2, X, Lock, RefreshCw,
  Camera, Keyboard, Layers3, Ruler, Crosshair, GitCompare, MoveHorizontal, Weight, ChevronDown, ChevronUp, Columns2,
} from "lucide-react";
import { toast } from "sonner";
import Viewer3D from "@/components/cad/Viewer3D";
import { CopilotDock, type DockTab } from "@/components/cad/CopilotDock";
import { ProviderModal } from "@/components/cad/ProviderModal";
import { BomDialog } from "@/components/cad/BomDialog";
import { VIEW_LABELS, VIEWS, type StatusMap, type ViewMode } from "@/components/cad/sceneBuilder";
import { api, ApiCallError, type ProjectState, type TransformResult, type PreviewResult } from "@/lib/cad/client-api";
import { estimateElementWeightKg } from "@/lib/cad/bom";
import type { ProjectDiff, ProjectDocument } from "@/lib/cad/schema";
import type { HistoryItem } from "@/components/cad/types";

const Viewer3DNoSSR = dynamic(() => import("@/components/cad/Viewer3D"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400 text-sm">
      <Loader2 className="h-6 w-6 animate-spin mr-2" /> carregando viewport 3D…
    </div>
  ),
});

const CompareSplitNoSSR = dynamic(() => import("@/components/cad/CompareSplit"), { ssr: false });

interface CandidateState {
  project: ProjectDocument;
  diff: ProjectDiff;
  diffSummary: string;
  baseRevision: number;
  baseHash: string;
  hash: string;
}

const HISTORY_KEY = "led-json-cad:history:v1";
const DOCK_WIDTH_KEY = "led-json-cad:dockwidth:v1";
const DOCK_MIN = 320;
const DOCK_MAX = 680;
const DOCK_DEFAULT = 390;

const ERRORS_FRIENDLY: Record<string, string> = {
  provider_timeout: "O provider de IA excedeu o tempo limite. Tente novamente — se persistir, troque o modelo no Conector de IA.",
  invalid_json: "A IA devolveu um JSON fora do contrato após 2 tentativas. Reformule o pedido ou troque o provider.",
  invalid_schema: "A IA devolveu um documento inválido (perfis/geometry fora das regras). Detalhes no histórico.",
  not_configured: "Provider não configurado — abra o CONECTOR DE IA e informe a API key.",
  unsupported_attachment: "Este provider/modelo não suporta este tipo de anexo. Use um modelo vision (ex.: glm-4.5v).",
  project_changed: "O projeto mudou desde o preview — regenere o candidato.",
  network: "Falha de rede ao contatar o servidor.",
};

export default function Home() {
  const [projectState, setProjectState] = useState<ProjectState | null>(null);
  const [candidate, setCandidate] = useState<CandidateState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("iso");
  const [tab, setTab] = useState<DockTab>("copiloto");
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [bomOpen, setBomOpen] = useState(false);
  const [providerLabel, setProviderLabel] = useState("carregando…");
  const [activeVision, setActiveVision] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [isolatedGroup, setIsolatedGroup] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [snapshotSignal, setSnapshotSignal] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measureResult, setMeasureResult] = useState<{ distance: number } | null>(null);
  const [comparingRev, setComparingRev] = useState<number | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState<"ghost" | "split">("ghost");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [dockWidth, setDockWidth] = useState(DOCK_DEFAULT);
  const dockDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const dockWidthRef = useRef(dockWidth);

  // arraste da alça de redimensionamento do dock (desktop)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dockDragRef.current;
      if (!drag) return;
      const maxW = Math.min(DOCK_MAX, Math.max(DOCK_MIN, Math.floor(window.innerWidth * 0.6)));
      const w = Math.min(maxW, Math.max(DOCK_MIN, drag.startW + (drag.startX - e.clientX)));
      dockWidthRef.current = w; // sync imediato — efeito passivo pode atrasar em headless
      setDockWidth(w);
    };
    const onUp = () => {
      if (!dockDragRef.current) return;
      dockDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(DOCK_WIDTH_KEY, String(dockWidthRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const pushHistory = useCallback((item: Omit<HistoryItem, "id" | "ts">) => {
    setHistory((h) => [
      ...h.slice(-59),
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: new Date().toISOString() },
    ]);
  }, []);

  // restaura histórico do localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryItem[]);
      const w = localStorage.getItem(DOCK_WIDTH_KEY);
      if (w) {
        const n = Number.parseInt(w, 10);
        if (Number.isFinite(n) && n >= DOCK_MIN && n <= DOCK_MAX) setDockWidth(n);
      }
    } catch {
      // ignora storage corrompido
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const st = await api.getProject();
      setProjectState(st);
    } catch (e) {
      toast.error((e as ApiCallError).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api
      .meta()
      .then((m) => {
        const active = m.providers.find((p) => p.active) ?? m.providers[0];
        setProviderLabel(`${active?.label ?? "mock"} · ${active?.current_model ?? ""}`);
        setActiveVision(active?.supports_image ?? true);
      })
      .catch(() => setProviderLabel("mock · mock-transformer-v1"));
  }, [refresh]);

  // ref síncrono do restoreInfo para uso no handler de teclado (evita stale closure)
  const restoreInfoRef = useRef<number | null>(null);
  useEffect(() => {
    restoreInfoRef.current = restoreInfo;
    if (restoreInfo === null) setCompareMode("ghost");
  }, [restoreInfo]);

  // Ctrl+Z → undo atômico; 1–7 → vistas; Esc → desselecionar; B → alterna ghost/A/B
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void doUndo();
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setMeasureMode(false);
        setMeasureResult(null);
        // Esc na comparação A/B volta para o modo ghost (2º Esc limpa o preview)
        setCompareMode((m) => (m === "split" && restoreInfoRef.current !== null ? "ghost" : m));
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key.toLowerCase() === "b" && restoreInfoRef.current !== null) {
        setCompareMode((m) => (m === "ghost" ? "split" : "ghost"));
        return;
      }
      const viewKeys = ["1", "2", "3", "4", "5", "6", "7"];
      const idx = viewKeys.indexOf(e.key);
      if (idx >= 0) setViewMode(VIEWS[idx]);
      if (e.key.toLowerCase() === "d") setShowDimensions((v) => !v);
      if (e.key.toLowerCase() === "m") setMeasureMode((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doUndo = useCallback(async () => {
    try {
      const st = await api.undo();
      setProjectState(st);
      setCandidate(null);
      setRestoreInfo(null);
      setHistoryRefreshKey((k) => k + 1);
      pushHistory({ role: "info", text: st.message ?? "desfeito" });
      toast.success("Desfeito — JSON anterior restaurado");
    } catch (e) {
      const err = e as ApiCallError;
      if (err.payload?.type === "nothing_to_undo") toast.info("Nada para desfazer");
      else toast.error(err.payload?.message ?? err.message);
    }
  }, [pushHistory]);

  // ---------- transform via IA ----------
  const sendRequest = useCallback(
    async (text: string, attachments: Array<{ type: "image"; name: string; data_url: string }>) => {
      if (!projectState) return;
      pushHistory({ role: "user", text });
      setSending(true);
      setCandidate(null);
      try {
        const r: TransformResult = await api.transform({
          request: text,
          base_revision: projectState.revision,
          base_hash: projectState.hash,
          attachments,
        });
        if (r.status === "ready" && r.candidate_project) {
          setCandidate({
            project: r.candidate_project,
            diff: (r.diff ?? { added: [], removed: [], modified: [], counts: { added: 0, removed: 0, modified: 0, total: 0 }, panel_changed: false, info_changed: false }),
            diffSummary: r.diff_summary ?? "",
            baseRevision: r.base_revision,
            baseHash: r.base_hash,
            hash: r.candidate_hash,
          });
          pushHistory({
            role: "assistant",
            text: r.explain,
            meta: {
              status: "ready",
              explain: r.explain,
              assumptions: r.assumptions,
              questions: r.questions,
              diffSummary: r.diff_summary,
              provider: r.meta.provider,
              model: r.meta.model,
              latency: r.meta.latency_ms,
              fewShot: r.meta.few_shot_id ?? null,
              fewShotScore: r.meta.few_shot_score ?? null,
              candidate: r.candidate_project,
            },
          });
        } else {
          pushHistory({
            role: "assistant",
            text: r.explain,
            meta: {
              status: "needs_input",
              explain: r.explain,
              questions: r.questions,
              assumptions: r.assumptions,
              provider: r.meta.provider,
              model: r.meta.model,
              latency: r.meta.latency_ms,
              fewShot: r.meta.few_shot_id ?? null,
              fewShotScore: r.meta.few_shot_score ?? null,
            },
          });
        }
      } catch (e) {
        const err = e as ApiCallError;
        const payload = err.payload;
        pushHistory({
          role: "error",
          text: ERRORS_FRIENDLY[payload?.type ?? ""] ?? payload?.message ?? err.message,
          meta: { errorType: payload?.type ?? "error" },
        });
      } finally {
        setSending(false);
      }
    },
    [projectState, pushHistory],
  );

  // ---------- preview de candidato (JSON tab / validação) ----------
  const previewCandidate = useCallback(
    async (doc: ProjectDocument): Promise<PreviewResult> => {
      try {
        const r = await api.preview(doc);
        if (r.ok && r.diff && projectState) {
          setCandidate({
            project: doc,
            diff: r.diff,
            diffSummary: r.diff_summary ?? "",
            baseRevision: r.base_revision ?? projectState.revision,
            baseHash: r.base_hash ?? projectState.hash,
            hash: r.candidate_hash ?? "",
          });
          pushHistory({ role: "info", text: `JSON validado — ${r.diff_summary}. Revise o preview 3D e aplique.` });
        }
        return r;
      } catch (e) {
        const err = e as ApiCallError;
        toast.error(err.payload?.message ?? err.message);
        return { ok: false, errors: [{ path: "preview", message: err.message }] };
      }
    },
    [projectState, pushHistory],
  );

  const applyCandidate = useCallback(async () => {
    if (!candidate) return;
    try {
      // restauração de revisão usa a rota dedicada (source "restore" no log)
      const st = restoreInfo !== null
        ? await api.restoreRevision(restoreInfo)
        : await api.apply({
            candidate: candidate.project,
            base_revision: candidate.baseRevision,
            base_hash: candidate.baseHash,
          });
      setProjectState(st);
      setCandidate(null);
      setRestoreInfo(null);
      setHistoryRefreshKey((k) => k + 1);
      setHistory((h) =>
        h.map((item) =>
          item.role === "assistant" && item.meta?.candidate && !item.meta.applied
            ? { ...item, meta: { ...item.meta, applied: true } }
            : item,
        ),
      );
      pushHistory({
        role: "info",
        text: restoreInfo !== null
          ? `Revisão ${restoreInfo} restaurada como revision ${st.revision}.`
          : `Candidato aplicado — revision ${st.revision}.`,
      });
      toast.success(restoreInfo !== null ? `Revisão ${restoreInfo} restaurada — rev ${st.revision}` : `Aplicado — revision ${st.revision}`);
    } catch (e) {
      const err = e as ApiCallError;
      if (err.status === 409) {
        toast.error("O projeto mudou desde o preview — regenere o candidato.");
        setCandidate(null);
        setRestoreInfo(null);
        void refresh();
      } else {
        toast.error(err.payload?.message ?? err.message);
      }
    }
  }, [candidate, restoreInfo, pushHistory, refresh]);

  // ---------- comparação com revisão do histórico ----------
  const compareRevision = useCallback(async (rev: number) => {
    if (!projectState) return;
    setComparingRev(rev);
    setRestoreInfo(null);
    try {
      const entry = await api.getRevisionDoc(rev);
      const r = await api.preview(entry.project);
      if (r.ok && r.diff && r.base_revision != null && r.base_hash != null) {
        setCandidate({
          project: entry.project,
          diff: r.diff,
          diffSummary: r.diff_summary ?? "",
          baseRevision: r.base_revision,
          baseHash: r.base_hash,
          hash: r.candidate_hash ?? "",
        });
        setRestoreInfo(rev);
        pushHistory({
          role: "info",
          text: `Comparando rev ${rev} com a atual — ${r.diff_summary}. APLICAR restaura a rev ${rev}; CANCELAR descarta.`,
        });
      } else if (!r.ok) {
        toast.error("Documento da revisão falhou na validação atual.");
      }
    } catch (e) {
      toast.error((e as ApiCallError).payload?.message ?? (e as ApiCallError).message);
    } finally {
      setComparingRev(null);
    }
  }, [projectState, pushHistory]);

  const cancelCandidate = useCallback(() => {
    setCandidate(null);
    setRestoreInfo(null);
    pushHistory({ role: "info", text: "Preview cancelado — documento atual preservado." });
  }, [pushHistory]);

  // ---------- status maps para o viewer ----------
  const { statuses, candidateStatuses } = useMemo((): { statuses: StatusMap; candidateStatuses: StatusMap } => {
    if (!projectState) return { statuses: {}, candidateStatuses: {} };
    if (!candidate) return { statuses: {}, candidateStatuses: {} };
    const oldIds = new Set(projectState.project.elements.map((e) => e.id));
    const newIds = new Set(candidate.project.elements.map((e) => e.id));
    const modified = new Set(candidate.diff.modified);
    const added = new Set(candidate.diff.added);
    const removed = new Set(candidate.diff.removed);
    const sOld: StatusMap = {};
    for (const id of oldIds) {
      sOld[id] = removed.has(id) ? "removed" : modified.has(id) ? "modified" : "unchanged";
    }
    const sNew: StatusMap = {};
    for (const id of newIds) {
      sNew[id] = added.has(id) ? "added" : modified.has(id) ? "modified" : "unchanged";
    }
    return { statuses: sOld, candidateStatuses: sNew };
  }, [projectState, candidate]);

  const selectedElement = useMemo(() => {
    const doc = candidate?.project ?? projectState?.project;
    return doc?.elements.find((e) => e.id === selectedId) ?? null;
  }, [projectState, candidate, selectedId]);

  const weightInfo = useMemo(
    () => (selectedElement ? estimateElementWeightKg(selectedElement) : null),
    [selectedElement],
  );

  const actions = {
    newProject: async () => {
      try {
        const st = await api.newProject();
        setProjectState(st);
        setCandidate(null);
        setRestoreInfo(null);
        setHistoryRefreshKey((k) => k + 1);
        pushHistory({ role: "info", text: "Novo projeto em branco criado." });
      } catch (e) {
        toast.error((e as ApiCallError).message);
      }
    },
    importJson: async (file: File) => {
      try {
        const text = await file.text();
        const doc = JSON.parse(text);
        const st = await api.importProject(doc);
        setProjectState(st);
        setCandidate(null);
        setRestoreInfo(null);
        setHistoryRefreshKey((k) => k + 1);
        pushHistory({ role: "info", text: "JSON importado e validado." });
        toast.success("Projeto importado");
      } catch (e) {
        toast.error((e as ApiCallError).payload?.message ?? (e as Error).message);
      }
    },
    exportPdf: async () => {
      setPdfBusy(true);
      try {
        await api.downloadPdf();
        toast.success("PDF gerado");
      } catch (e) {
        toast.error((e as ApiCallError).payload?.message ?? (e as Error).message);
      } finally {
        setPdfBusy(false);
      }
    },
  };

  // persiste histórico (sem candidatos antigos pesados)
  useEffect(() => {
    try {
      const slim = history.slice(-30).map((h) => ({
        ...h,
        meta: h.meta?.candidate ? { ...h.meta, candidate: null } : h.meta,
      }));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
    } catch {
      // quota — ignora
    }
  }, [history]);

  const toggleHidden = useCallback((id: string) => {
    setHiddenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const isolateGroup = useCallback((group: string | null) => {
    setIsolatedGroup(group);
    if (!projectState) return;
    const doc = candidate?.project ?? projectState.project;
    if (group === null) {
      setHiddenIds(new Set());
    } else {
      setHiddenIds(new Set(doc.elements.filter((e) => e.group !== group).map((e) => e.id)));
    }
  }, [projectState, candidate]);

  const focusElement = useCallback((id: string) => {
    setSelectedId(id);
    setFocusRequest({ id, nonce: Date.now() });
  }, []);

  const fitKey = `${projectState?.revision ?? 0}:${projectState?.hash?.slice(0, 8) ?? ""}:${candidate?.hash.slice(0, 8) ?? "none"}`;
  const project = projectState?.project;
  /** comparação A/B ativa (dois viewports) — só no fluxo de restauração de revisão */
  const splitActive = restoreInfo !== null && compareMode === "split" && candidate !== null;

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-slate-100 text-slate-900">
        {/* ---------- TOPBAR ---------- */}
        <header className="flex items-center gap-2 px-3 sm:px-4 h-14 bg-gradient-to-r from-[#141f2b] via-[#1b2836] to-[#223344] text-slate-100 shrink-0 border-b-4 border-orange-600 shadow-md" role="banner">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded bg-orange-600 grid place-items-center font-black text-white text-sm shrink-0" aria-hidden>
              LC
            </div>
            <div className="leading-tight min-w-0">
              <div className="font-bold text-sm tracking-wide truncate">LED JSON CAD</div>
              <div className="text-[10px] text-slate-400 truncate">documento JSON · mm · Z solo</div>
            </div>
          </div>

          {project && (
            <div className="hidden md:flex items-center gap-2 ml-4 min-w-0">
              <span className="text-sm font-medium truncate max-w-56" title={project.project.name}>
                {project.project.name}
              </span>
              <Badge variant="outline" className="text-slate-300 border-slate-500">
                rev {projectState!.revision}
              </Badge>
              <button
                onClick={() => {
                  const h = projectState!.hash;
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(h).then(() => toast.success(`Hash ${h.slice(0, 8)} copiado`)).catch(() => toast.error("Não foi possível copiar"));
                  }
                }}
                title={`Copiar hash completo (${projectState!.hash})`}
                aria-label={`Copiar hash de revisão ${projectState!.hash}`}
                className="outline-none"
              >
                <Badge variant="outline" className="text-slate-400 border-slate-600 font-mono text-[10px] hover:text-white hover:border-slate-400 transition-colors cursor-pointer">
                  {projectState!.hash.slice(0, 8)}
                </Badge>
              </button>
              <Badge variant="outline" className="text-slate-400 border-slate-600">
                {project.elements.length} el.
              </Badge>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <input
              ref={importFileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void actions.importJson(f);
                e.target.value = "";
              }}
            />
            <TopBtn icon={<FilePlus2 className="h-4 w-4" />} label="NOVO" onClick={() => void actions.newProject()} />
            <TopBtn icon={<Upload className="h-4 w-4" />} label="IMPORTAR" onClick={() => importFileRef.current?.click()} />
            <TopBtn icon={<Undo2 className="h-4 w-4" />} label="DESFAZER" onClick={() => void doUndo()} title="Ctrl+Z" />
            <TopBtn icon={<FileSpreadsheet className="h-4 w-4" />} label="BOM" onClick={() => setBomOpen(true)} />
            <TopBtn
              icon={pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              label="PDF"
              onClick={() => void actions.exportPdf()}
              disabled={pdfBusy}
            />
            <TopBtn icon={<PlugZap className="h-4 w-4" />} label="IA" onClick={() => setProviderModalOpen(true)} highlight />
          </div>
        </header>

        {/* ---------- MAIN ---------- */}
        <main className="flex-1 flex flex-col lg:flex-row min-h-0" role="main">
          {/* VIEWPORT */}
          <section className="relative flex-1 min-h-[45vh] lg:min-h-0 bg-slate-100" aria-label="Viewport 3D">
            {project ? (
              <div className={`absolute inset-0 ${splitActive ? "invisible" : ""}`} aria-hidden={splitActive}>
                <Viewer3DNoSSR
                project={project}
                candidate={candidate?.project ?? null}
                statuses={statuses}
                candidateStatuses={candidateStatuses}
                selectedId={selectedId}
                onSelect={setSelectedId}
                viewMode={viewMode}
                fitKey={fitKey}
                hiddenIds={hiddenIds}
                focusRequest={focusRequest}
                snapshotSignal={snapshotSignal}
                showDimensions={showDimensions}
                measureMode={measureMode}
                onMeasureResult={setMeasureResult}
                paused={splitActive}
                />
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}

            {/* COMPARAÇÃO A/B — dois viewports sincronizados (restauração de revisão) */}
            {splitActive && project && candidate && (
              <CompareSplitNoSSR
                docA={project}
                revA={projectState!.revision}
                docB={candidate.project}
                revB={restoreInfo!}
                statusesA={statuses}
                statusesB={candidateStatuses}
                diffCounts={candidate.diff.counts}
                onClose={() => setCompareMode("ghost")}
              />
            )}

            {/* vistas — linha única com scroll em telas pequenas + atalhos (ocultas na comparação A/B) */}
            {!splitActive && (
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 max-w-[95%] flex items-center gap-1" role="toolbar" aria-label="Vistas da câmera">
              <div className="relative flex items-center min-w-0 max-w-full">
                <div className="flex items-center gap-0.5 bg-white/90 backdrop-blur rounded-full px-1.5 py-1 shadow-md border border-slate-200 overflow-x-auto cad-scroll max-w-full">
                  {VIEWS.map((v, i) => (
                    <button
                      key={v}
                      onClick={() => setViewMode(v)}
                      title={`${VIEW_LABELS[v]} (${i + 1})`}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        viewMode === v ? "bg-orange-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-200"
                      }`}
                      aria-pressed={viewMode === v}
                    >
                      {VIEW_LABELS[v]}
                    </button>
                  ))}
                </div>
                {/* fade que indica scroll horizontal */}
                <div className="pointer-events-none absolute inset-y-0 right-0 w-7 rounded-r-full bg-gradient-to-l from-white/95 via-white/60 to-transparent" aria-hidden />
              </div>
              <button
                onClick={() => setSnapshotSignal((n) => n + 1)}
                title="Exportar PNG do viewport"
                aria-label="Exportar PNG do viewport"
                className="h-8 w-8 grid place-items-center rounded-full bg-white/90 backdrop-blur shadow-md border border-slate-200 text-slate-600 hover:text-orange-600 hover:border-orange-300 transition-colors shrink-0"
              >
                <Camera className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setShowDimensions((v) => !v);
                  setShortcutsOpen(false);
                }}
                title={`Cotas L/H/P (D) — ${showDimensions ? "ativas" : "desativadas"}`}
                aria-label="Alternar cotas de dimensões"
                aria-pressed={showDimensions}
                className={`h-8 w-8 grid place-items-center rounded-full shadow-md border transition-colors shrink-0 ${
                  showDimensions ? "bg-orange-600 border-orange-600 text-white" : "bg-white/90 border-slate-200 text-slate-600 hover:text-orange-600 hover:border-orange-300"
                }`}
              >
                <Ruler className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setMeasureMode((v) => !v);
                  setMeasureResult(null);
                  setShortcutsOpen(false);
                }}
                title={`Medir distância entre dois pontos (M) — ${measureMode ? "ativo" : "inativo"}`}
                aria-label="Alternar ferramenta de medição"
                aria-pressed={measureMode}
                className={`h-8 w-8 grid place-items-center rounded-full shadow-md border transition-colors shrink-0 ${
                  measureMode ? "bg-orange-600 border-orange-600 text-white" : "bg-white/90 border-slate-200 text-slate-600 hover:text-orange-600 hover:border-orange-300"
                }`}
              >
                <Crosshair className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShortcutsOpen((o) => !o)}
                title="Atalhos de teclado"
                aria-label="Atalhos de teclado"
                className={`h-8 w-8 grid place-items-center rounded-full shadow-md border transition-colors shrink-0 ${
                  shortcutsOpen ? "bg-orange-600 border-orange-600 text-white" : "bg-white/90 border-slate-200 text-slate-600 hover:text-orange-600 hover:border-orange-300"
                }`}
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </div>
            )}

            {/* popover de atalhos */}
            <AnimatePresence>
              {shortcutsOpen && !splitActive && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-12 right-3 w-64 bg-white/95 backdrop-blur border border-slate-200 shadow-xl rounded-xl p-3 z-10"
                  role="dialog"
                  aria-label="Atalhos de teclado"
                >
                  <div className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Keyboard className="h-3.5 w-3.5 text-orange-600" /> ATALHOS
                  </div>
                  <ul className="text-[11px] text-slate-600 space-y-1.5">
                    {[...Array(7)].map((_, i) => (
                      <li key={i} className="flex items-center justify-between">
                        <span>{VIEW_LABELS[VIEWS[i]]}</span>
                        <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">{i + 1}</kbd>
                      </li>
                    ))}
                    <li className="flex items-center justify-between">
                      <span>Desfazer</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Ctrl+Z</kbd>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Cotas L/H/P</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">D</kbd>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Medir distância</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">M</kbd>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Alternar comparação A/B</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">B</kbd>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Desselecionar / sair do modo</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Esc</kbd>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Enviar pedido</span>
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Enter</kbd>
                    </li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>

            {/* badge do modo medição */}
            {measureMode && !splitActive && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-12 right-3 flex items-center gap-2 bg-white/95 backdrop-blur border border-orange-300 shadow-lg rounded-lg px-3 py-1.5 text-[11px] z-10"
                role="status"
              >
                <Crosshair className="h-3.5 w-3.5 text-orange-600" />
                {measureResult ? (
                  <span className="font-bold text-orange-700 flex items-center gap-1.5">
                    <MoveHorizontal className="h-3.5 w-3.5" />
                    {Math.round(measureResult.distance)} mm
                    <span className="text-slate-400 font-normal">({(measureResult.distance / 1000).toFixed(3)} m)</span>
                  </span>
                ) : (
                  <span className="text-slate-600">clique em 2 pontos do modelo para medir · Esc sai</span>
                )}
              </motion.div>
            )}

            {/* badge grupo isolado */}
            {isolatedGroup && !splitActive && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => isolateGroup(null)}
                className="absolute top-12 left-3 flex items-center gap-1.5 bg-orange-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-lg"
                title="remover isolamento"
              >
                <Layers3 className="h-3 w-3" /> ISOLADO: {isolatedGroup} ×
              </motion.button>
            )}

            {/* info do elemento selecionado */}
            <AnimatePresence>
              {selectedElement && !splitActive && (
                <motion.div
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.16 }}
                  className="absolute top-2.5 left-2.5 bg-white/95 backdrop-blur border border-slate-200 shadow-lg rounded-xl p-3 text-xs max-w-64"
                  role="status"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-orange-700">{selectedElement.id}</span>
                    <button onClick={() => setSelectedId(null)} aria-label="Fechar info do elemento" className="text-slate-400 hover:text-slate-700">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-slate-600">
                    <span className="text-slate-400">tipo</span><span>{selectedElement.type}</span>
                    <span className="text-slate-400">role</span><span>{selectedElement.role}</span>
                    <span className="text-slate-400">grupo</span><span className="truncate">{selectedElement.group}</span>
                    {selectedElement.type === "beam" && (
                      <>
                        <span className="text-slate-400">perfil</span><span>{selectedElement.profile}</span>
                        <span className="text-slate-400">start</span><span className="font-mono text-[10px]">{fmtV(selectedElement.start)}</span>
                        <span className="text-slate-400">end</span><span className="font-mono text-[10px]">{fmtV(selectedElement.end)}</span>
                      </>
                    )}
                    {selectedElement.type === "plate" && (
                      <><span className="text-slate-400">size</span><span className="font-mono text-[10px]">{selectedElement.size_x}×{selectedElement.size_y}×{selectedElement.size_z}</span></>
                    )}
                    {selectedElement.type === "cable" && (
                      <><span className="text-slate-400">Ø</span><span>{selectedElement.diameter} mm</span></>
                    )}
                    {weightInfo && (
                      <>
                        <span className="text-slate-400 flex items-center gap-1"><Weight className="h-3 w-3" /> peso</span>
                        <span className="font-semibold text-slate-700">≈ {weightInfo < 10 ? weightInfo.toFixed(2) : weightInfo.toFixed(1)} kg</span>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* legenda de diff → inspector detalhado ao clicar (só no modo ghost) */}
            {candidate && !splitActive && (
              <DiffInspector
                diff={candidate.diff}
                onPick={(id) => focusElement(id)}
              />
            )}

            {/* PREVIEW BAR */}
            <AnimatePresence>
              {candidate && (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 24 }}
                  transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(680px,92%)] bg-[#1b2836]/95 backdrop-blur text-white rounded-xl shadow-2xl border border-orange-500/60 px-4 py-2.5 flex flex-col sm:flex-row items-center gap-2 z-20"
                  role="alertdialog"
                  aria-label="Preview de alterações propostas"
                >
                  <div className="text-sm flex-1 min-w-0">
                    {restoreInfo !== null ? (
                      <span className="font-bold text-amber-300 flex items-center gap-1.5 flex-wrap">
                        <GitCompare className="h-4 w-4" /> COMPARAÇÃO COM REV {restoreInfo}
                      </span>
                    ) : (
                      <span className="font-bold text-orange-400">{candidate.diff.counts.total} alterações propostas</span>
                    )}
                    <span className="text-slate-300 text-xs ml-2 hidden sm:inline truncate">
                      {candidate.diff.counts.added} novas · {candidate.diff.counts.modified} editadas · {candidate.diff.counts.removed} removidas
                      {candidate.diff.panel_changed ? " · painel alterado" : ""}
                    </span>
                  </div>
                  <div className="flex gap-2 items-center flex-wrap justify-center sm:justify-end">
                    {/* alternador de modo de comparação (só no fluxo de restauração) */}
                    {restoreInfo !== null && (
                      <div
                        className="flex rounded-lg overflow-hidden border border-slate-500/70 shrink-0"
                        role="radiogroup"
                        aria-label="Modo de comparação visual"
                      >
                        <button
                          role="radio"
                          aria-checked={compareMode === "ghost"}
                          onClick={() => setCompareMode("ghost")}
                          title="Diff por transparência no viewport atual (B alterna)"
                          className={`px-2.5 py-1.5 text-[10px] font-bold tracking-wide transition-colors ${
                            compareMode === "ghost" ? "bg-slate-200 text-slate-900" : "text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          GHOST
                        </button>
                        <button
                          role="radio"
                          aria-checked={compareMode === "split"}
                          onClick={() => setCompareMode("split")}
                          title="Dois viewports lado a lado com órbita sincronizada (B alterna)"
                          className={`px-2.5 py-1.5 text-[10px] font-bold tracking-wide transition-colors flex items-center gap-1 ${
                            compareMode === "split" ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-700"
                          }`}
                        >
                          <Columns2 className="h-3 w-3" /> A/B
                        </button>
                      </div>
                    )}
                    <Button size="sm" onClick={() => void applyCandidate()} className={restoreInfo !== null ? "bg-amber-500 hover:bg-amber-600 text-white font-bold px-5 shadow-lg shadow-amber-900/40" : "bg-green-600 hover:bg-green-700 text-white font-bold px-5 shadow-lg shadow-green-900/40"}>
                      {restoreInfo !== null ? `RESTAURAR REV ${restoreInfo}` : "APLICAR"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelCandidate}
                      className="border-slate-500 text-slate-200 hover:bg-slate-700"
                    >
                      CANCELAR
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* DOCK (redimensionável em lg+) */}
          <div
            className="relative h-[46vh] lg:h-auto min-h-0 shrink-0 w-full lg:w-[var(--dock-w)]"
            style={{ "--dock-w": `${dockWidth}px` } as React.CSSProperties}
            data-dock-wrap
          >
            {/* alça de redimensionamento (desktop) */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar painel lateral"
              aria-valuenow={dockWidth}
              aria-valuemin={DOCK_MIN}
              aria-valuemax={DOCK_MAX}
              tabIndex={0}
              onMouseDown={(e) => {
                dockDragRef.current = { startX: e.clientX, startW: dockWidth };
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                e.preventDefault();
              }}
              onKeyDown={(e) => {
                const bump = (delta: number) => {
                  const w = Math.min(DOCK_MAX, Math.max(DOCK_MIN, dockWidthRef.current + delta));
                  dockWidthRef.current = w;
                  setDockWidth(w);
                  try { localStorage.setItem(DOCK_WIDTH_KEY, String(w)); } catch { /* ignore */ }
                };
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  bump(24);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  bump(-24);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  dockWidthRef.current = DOCK_DEFAULT;
                  setDockWidth(DOCK_DEFAULT);
                  try { localStorage.setItem(DOCK_WIDTH_KEY, String(DOCK_DEFAULT)); } catch { /* ignore */ }
                }
              }}
              onDoubleClick={() => {
                setDockWidth(DOCK_DEFAULT);
                try { localStorage.setItem(DOCK_WIDTH_KEY, String(DOCK_DEFAULT)); } catch { /* ignore */ }
              }}
              className="hidden lg:block absolute top-0 left-0 h-full w-1.5 -ml-0.5 cursor-col-resize z-20 group"
              title="Arraste para redimensionar · duplo clique restaura · ←/→ ajusta"
            >
              <div className="h-full w-full rounded-full bg-slate-300/50 group-hover:bg-orange-500/60 group-focus-visible:bg-orange-500 transition-colors" />
            </div>
            <div className="h-full w-full" style={{ width: "100%" }} data-dock-inner>
              {project && (
                <CopilotDock
                  tab={tab}
                  onTabChange={setTab}
                  history={history}
                  sending={sending}
                  onSend={(t, a) => void sendRequest(t, a)}
                  project={project}
                  projectKey={`${projectState!.revision}:${projectState!.hash.slice(0, 8)}`}
                  onPreviewCandidate={previewCandidate}
                  selectedElement={selectedElement}
                  activeProviderLabel={providerLabel}
                  activeVision={activeVision}
                  onOpenProviders={() => setProviderModalOpen(true)}
                  onOpenJsonTab={() => setTab("json")}
                  onAppliedCandidate={() => void refresh()}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  hiddenIds={hiddenIds}
                  onToggleHidden={toggleHidden}
                  onIsolateGroup={isolateGroup}
                  isolatedGroup={isolatedGroup}
                  onFocusElement={focusElement}
                  candidateDoc={candidate?.project ?? null}
                  comparingRev={comparingRev}
                  onCompareRevision={(rev) => void compareRevision(rev)}
                  historyRefreshKey={historyRefreshKey}
                  onRevisionRestored={() => void refresh()}
                />
              )}
            </div>
          </div>
        </main>

        {/* ---------- FOOTER (status) ---------- */}
        <footer className="h-7 shrink-0 bg-[#141f2b] text-slate-400 text-[11px] flex items-center gap-3 px-3 overflow-hidden" role="contentinfo">
          <span className="text-orange-500 font-semibold shrink-0">LED Collor</span>
          <span className="hidden sm:inline truncate">JSON do projeto é a fonte de verdade · canvas é visualização · PDF/BOM derivados</span>
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {candidate && <span className="text-orange-400 font-semibold">PREVIEW ATIVO</span>}
            {splitActive && <span className="text-amber-300 font-semibold hidden md:inline cad-pulse-soft">A/B rev {restoreInfo}</span>}
            {isolatedGroup && <span className="text-amber-400 hidden md:inline">isolando {isolatedGroup}</span>}
            <span className="hidden lg:inline">
              {project?.elements.length ?? 0} el. · {new Set((project?.elements ?? []).map((e) => e.group)).size} grupos
            </span>
            <Lock className="h-3 w-3" aria-hidden />
            <span>unidade: mm</span>
            <span className="hidden md:inline font-mono">{projectState?.hash.slice(0, 8) ?? "—"}</span>
            <button
              onClick={() => {
                void refresh();
                void api
                  .meta()
                  .then((m) => {
                    const active = m.providers.find((p) => p.active) ?? m.providers[0];
                    setProviderLabel(`${active?.label ?? "mock"} · ${active?.current_model ?? ""}`);
                  })
                  .catch(() => undefined);
              }}
              title="Atualizar status"
              className="hover:text-white"
              aria-label="Atualizar status"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </span>
        </footer>

        <ProviderModal
          open={providerModalOpen}
          onOpenChange={setProviderModalOpen}
          onActivated={() => {
            void api
              .meta()
              .then((m) => {
                const active = m.providers.find((p) => p.active) ?? m.providers[0];
                setProviderLabel(`${active?.label ?? "mock"} · ${active?.current_model ?? ""}`);
              })
              .catch(() => undefined);
          }}
        />
        <BomDialog open={bomOpen} onOpenChange={setBomOpen} />
      </div>
    </TooltipProvider>
  );
}

function TopBtn({
  icon,
  label,
  onClick,
  title,
  disabled,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`h-9 px-2 sm:px-2.5 text-[10px] sm:text-[11px] font-semibold gap-1 ${
        highlight ? "text-orange-400 hover:text-orange-300 hover:bg-slate-700" : "text-slate-200 hover:text-white hover:bg-slate-700"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-600">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </div>
  );
}

/**
 * INSPECTOR DE DIFF — legenda clicável que expande a lista detalhada de elementos
 * alterados (adicionadas/editadas/removidas). Clicar num ID enquadra o elemento no viewport.
 */
function DiffInspector({ diff, onPick }: { diff: ProjectDiff; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const sections: Array<{ key: "added" | "modified" | "removed"; color: string; label: string; ids: string[]; clickable: boolean }> = [
    { key: "added", color: "#16a34a", label: "adicionadas", ids: diff.added, clickable: true },
    { key: "modified", color: "#ea580c", label: "editadas", ids: diff.modified, clickable: true },
    { key: "removed", color: "#dc2626", label: "removidas", ids: diff.removed, clickable: false },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-[108px] sm:bottom-[68px] left-2.5 max-w-72 bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-md overflow-hidden z-10"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-slate-50 transition-colors"
        title={open ? "Recolher detalhes do diff" : "Ver lista detalhada do diff"}
      >
        <span className="font-bold text-slate-700">DIFF</span>
        <span className="flex items-center gap-2.5">
          <Legend color="#16a34a" label={`+${diff.counts.added}`} />
          <Legend color="#ea580c" label={`~${diff.counts.modified}`} />
          <Legend color="#dc2626" label={`-${diff.counts.removed}`} />
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 ml-auto text-slate-400" /> : <ChevronUp className="h-3.5 w-3.5 ml-auto text-slate-400" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="border-t border-slate-200"
          >
            <div className="max-h-52 overflow-y-auto cad-scroll p-2.5 space-y-2">
              {diff.counts.total === 0 && (
                <p className="text-[11px] text-slate-500 px-0.5">Nenhuma alteração geométrica — apenas metadados.</p>
              )}
              {sections.map((s) =>
                s.ids.length === 0 ? null : (
                  <div key={s.key}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        {s.label} ({s.ids.length})
                      </span>
                      {!s.clickable && (
                        <span className="text-[9.5px] text-slate-400 font-normal">· só no documento atual</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.ids.slice(0, 40).map((id) =>
                        s.clickable ? (
                          <button
                            key={id}
                            onClick={() => onPick(id)}
                            title={`Enquadrar ${id} no viewport`}
                            className="px-1.5 py-0.5 rounded-md border font-mono text-[10px] transition-colors hover:text-white"
                            style={{ borderColor: `${s.color}55`, color: s.color, backgroundColor: `${s.color}0d` }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = s.color)}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = `${s.color}0d`)}
                          >
                            {id}
                          </button>
                        ) : (
                          <span
                            key={id}
                            className="px-1.5 py-0.5 rounded-md border font-mono text-[10px] border-slate-300 text-slate-400 bg-slate-100 cursor-not-allowed line-through decoration-slate-300"
                            title="Elemento existente apenas no documento atual — não presente no preview"
                          >
                            {id}
                          </span>
                        ),
                      )}
                      {s.ids.length > 40 && (
                        <span className="text-[10px] text-slate-400 self-center">+{s.ids.length - 40}…</span>
                      )}
                    </div>
                  </div>
                ),
              )}
              {diff.panel_changed && (
                <p className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                  Dimensões do painel alteradas — textura LED e vista regeneradas.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function fmtV(v: { x: number; y: number; z: number }): string {
  return `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`;
}
