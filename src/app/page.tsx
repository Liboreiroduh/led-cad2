"use client";

/**
 * LED JSON CAD — página principal.
 * JSON do projeto é a autoridade; canvas é visualização; IA transforma documentos;
 * diff calculado pelo sistema; preview antes de apply; undo por snapshot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  FilePlus2, Upload, Undo2, FileSpreadsheet, FileDown, PlugZap, Loader2, X, Lock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import Viewer3D from "@/components/cad/Viewer3D";
import { CopilotDock, type DockTab } from "@/components/cad/CopilotDock";
import { ProviderModal } from "@/components/cad/ProviderModal";
import { BomDialog } from "@/components/cad/BomDialog";
import { VIEW_LABELS, VIEWS, type StatusMap, type ViewMode } from "@/components/cad/sceneBuilder";
import { api, ApiCallError, type ProjectState, type TransformResult, type PreviewResult } from "@/lib/cad/client-api";
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

interface CandidateState {
  project: ProjectDocument;
  diff: ProjectDiff;
  diffSummary: string;
  baseRevision: number;
  baseHash: string;
  hash: string;
}

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
  const [pdfBusy, setPdfBusy] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const pushHistory = useCallback((item: Omit<HistoryItem, "id" | "ts">) => {
    setHistory((h) => [
      ...h,
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: new Date().toISOString() },
    ]);
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
      })
      .catch(() => setProviderLabel("mock · mock-transformer-v1"));
  }, [refresh]);

  // Ctrl+Z → undo atômico (snapshot anterior)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void doUndo();
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doUndo = useCallback(async () => {
    try {
      const st = await api.undo();
      setProjectState(st);
      setCandidate(null);
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
      const st = await api.apply({
        candidate: candidate.project,
        base_revision: candidate.baseRevision,
        base_hash: candidate.baseHash,
      });
      setProjectState(st);
      setCandidate(null);
      setHistory((h) =>
        h.map((item) =>
          item.role === "assistant" && item.meta?.candidate && !item.meta.applied
            ? { ...item, meta: { ...item.meta, applied: true } }
            : item,
        ),
      );
      pushHistory({ role: "info", text: `Candidato aplicado — revision ${st.revision}.` });
      toast.success(`Aplicado — revision ${st.revision}`);
    } catch (e) {
      const err = e as ApiCallError;
      if (err.status === 409) {
        toast.error("O projeto mudou desde o preview — regenere o candidato.");
        setCandidate(null);
        void refresh();
      } else {
        toast.error(err.payload?.message ?? err.message);
      }
    }
  }, [candidate, pushHistory, refresh]);

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

  const actions = {
    newProject: async () => {
      try {
        const st = await api.newProject();
        setProjectState(st);
        setCandidate(null);
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

  const fitKey = `${projectState?.revision ?? 0}:${projectState?.hash?.slice(0, 8) ?? ""}:${candidate?.hash.slice(0, 8) ?? "none"}`;
  const project = projectState?.project;

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-slate-100 text-slate-900">
        {/* ---------- TOPBAR ---------- */}
        <header className="flex items-center gap-2 px-3 sm:px-4 h-14 bg-[#1b2836] text-slate-100 shrink-0 border-b-4 border-orange-600" role="banner">
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
              <Badge variant="outline" className="text-slate-400 border-slate-600 font-mono text-[10px]">
                {projectState!.hash.slice(0, 8)}
              </Badge>
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
              <Viewer3DNoSSR
                project={project}
                candidate={candidate?.project ?? null}
                statuses={statuses}
                candidateStatuses={candidateStatuses}
                selectedId={selectedId}
                onSelect={setSelectedId}
                viewMode={viewMode}
                fitKey={fitKey}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}

            {/* vistas */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-1 bg-white/85 backdrop-blur rounded-full px-2 py-1 shadow border border-slate-200" role="toolbar" aria-label="Vistas da câmera">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                    viewMode === v ? "bg-orange-600 text-white" : "text-slate-600 hover:bg-slate-200"
                  }`}
                  aria-pressed={viewMode === v}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>

            {/* info do elemento selecionado */}
            {selectedElement && (
              <div className="absolute top-2.5 left-2.5 bg-white/95 border border-slate-200 shadow rounded-lg p-3 text-xs max-w-64" role="status">
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
                </div>
              </div>
            )}

            {/* legenda de diff */}
            {candidate && (
              <div className="absolute bottom-2.5 left-2.5 bg-white/90 border border-slate-200 rounded-lg px-3 py-2 text-[11px] space-y-1 shadow">
                <Legend color="#16a34a" label={`adicionadas (${candidate.diff.counts.added})`} />
                <Legend color="#ea580c" label={`editadas (${candidate.diff.counts.modified})`} />
                <Legend color="#dc2626" label={`removidas (${candidate.diff.counts.removed})`} />
                <Legend color="#64748b" label="inalteradas" />
              </div>
            )}

            {/* PREVIEW BAR */}
            {candidate && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(680px,92%)] bg-[#1b2836]/95 backdrop-blur text-white rounded-xl shadow-2xl border border-slate-600 px-4 py-2.5 flex flex-col sm:flex-row items-center gap-2" role="alertdialog" aria-label="Preview de alterações propostas">
                <div className="text-sm flex-1 min-w-0">
                  <span className="font-bold text-orange-400">{candidate.diff.counts.total} alterações propostas</span>
                  <span className="text-slate-300 text-xs ml-2 hidden sm:inline truncate">
                    {candidate.diff.counts.added} novas · {candidate.diff.counts.modified} editadas · {candidate.diff.counts.removed} removidas
                    {candidate.diff.panel_changed ? " · painel alterado" : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void applyCandidate()} className="bg-green-600 hover:bg-green-700 text-white font-bold px-5">
                    APLICAR
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCandidate(null);
                      pushHistory({ role: "info", text: "Preview cancelado — documento atual preservado." });
                    }}
                    className="border-slate-500 text-slate-200 hover:bg-slate-700"
                  >
                    CANCELAR
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* DOCK */}
          <div className="h-[46vh] lg:h-auto lg:w-[390px] xl:w-[420px] shrink-0 min-h-0">
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
                onOpenProviders={() => setProviderModalOpen(true)}
                onOpenJsonTab={() => setTab("json")}
                onAppliedCandidate={() => void refresh()}
              />
            )}
          </div>
        </main>

        {/* ---------- FOOTER (status) ---------- */}
        <footer className="h-7 shrink-0 bg-[#141f2b] text-slate-400 text-[11px] flex items-center gap-3 px-3 overflow-hidden" role="contentinfo">
          <span className="text-orange-500 font-semibold shrink-0">LED Collor</span>
          <span className="hidden sm:inline truncate">JSON do projeto é a fonte de verdade · canvas é visualização · PDF/BOM derivados</span>
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {candidate && <span className="text-orange-400 font-semibold">PREVIEW ATIVO</span>}
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

function fmtV(v: { x: number; y: number; z: number }): string {
  return `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`;
}
