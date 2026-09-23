"use client";

/**
 * RevisionHistory — linha do tempo de revisões do projeto (server-side).
 * Cada revisão pode ser COMPARADA com a atual (diff ghost no 3D) e restaurada
 * via fluxo padrão de preview → aplicar.
 */
import { useCallback, useEffect, useState } from "react";
import {
  History, RefreshCw, Loader2, GitCompare, Sparkles, Braces, Upload, FileJson,
  Undo2, RotateCcw, FilePlus2, Circle, Monitor, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, ApiCallError, type RevisionListItem } from "@/lib/cad/client-api";

const SOURCE_META: Record<
  RevisionListItem["source"],
  { label: string; color: string; dot: string; icon: React.ReactNode }
> = {
  ai_apply: { label: "IA aplicada", color: "bg-orange-100 text-orange-800 border-orange-300", dot: "bg-orange-500", icon: <Sparkles className="h-3 w-3" /> },
  manual_json: { label: "Editor JSON", color: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-500", icon: <Braces className="h-3 w-3" /> },
  import: { label: "Importado", color: "bg-amber-100 text-amber-800 border-amber-300", dot: "bg-amber-500", icon: <Upload className="h-3 w-3" /> },
  preset: { label: "Preset", color: "bg-emerald-100 text-emerald-800 border-emerald-300", dot: "bg-emerald-500", icon: <FileJson className="h-3 w-3" /> },
  undo: { label: "Desfeito", color: "bg-slate-100 text-slate-600 border-slate-300", dot: "bg-slate-400", icon: <Undo2 className="h-3 w-3" /> },
  restore: { label: "Restaurado", color: "bg-rose-100 text-rose-800 border-rose-300", dot: "bg-rose-500", icon: <RotateCcw className="h-3 w-3" /> },
  new: { label: "Novo", color: "bg-slate-100 text-slate-600 border-slate-300", dot: "bg-slate-400", icon: <FilePlus2 className="h-3 w-3" /> },
  init: { label: "Inicial", color: "bg-slate-100 text-slate-600 border-slate-300", dot: "bg-slate-300", icon: <Circle className="h-3 w-3" /> },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`;
  return `${Math.floor(diff / 86400_000)} d`;
}

interface RevisionHistoryProps {
  comparingRev: number | null;
  onCompare: (rev: number) => void;
  /** incrementa para recarregar a lista (após apply/undo/import) */
  refreshKey: number;
  /** chamado após restauração bem-sucedida */
  onRestored: () => void;
}

export function RevisionHistory({ comparingRev, onCompare, refreshKey, onRestored }: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<RevisionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState<number | null>(null);

  const downloadDiffPdf = async (rev: number) => {
    setPdfBusy(rev);
    try {
      await api.downloadDiffPdf(rev);
      toast.success(`Relatório de diferenças rev ${rev} gerado`);
    } catch (e) {
      const err = e as ApiCallError;
      toast.error(err.payload?.message ?? err.message);
    } finally {
      setPdfBusy(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.listRevisions();
      setRevisions(r.revisions);
    } catch (e) {
      setError((e as ApiCallError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const restore = async (rev: number) => {
    setRestoring(rev);
    try {
      const st = await api.restoreRevision(rev);
      void st;
      onRestored();
    } catch (e) {
      const err = e as ApiCallError;
      if (err.status === 409) setError("O projeto mudou — recarregue e tente de novo.");
      else setError(err.payload?.message ?? err.message);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50/80">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-orange-600" />
          REVISÕES DO PROJETO
        </span>
        <button
          onClick={() => void load()}
          className="text-slate-400 hover:text-orange-600 transition-colors"
          aria-label="Recarregar histórico"
          title="Recarregar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto cad-scroll p-3 min-h-0">
        {loading && revisions.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> carregando histórico…
          </div>
        )}
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-2">{error}</div>
        )}
        {!loading && revisions.length === 0 && !error && (
          <div className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-lg p-3">
            Nenhuma revisão registrada ainda. Cada aplicação da IA, importação, preset ou undo gera uma entrada.
          </div>
        )}

        <ol className="relative ml-2 border-l-2 border-slate-200 space-y-2.5">
          {revisions.map((r) => {
            const meta = SOURCE_META[r.source] ?? SOURCE_META.init;
            const busy = comparingRev === r.revision;
            return (
              <li key={`${r.revision}-${r.hash.slice(0, 10)}`} className="relative pl-4">
                {/* ponto da timeline */}
                <span
                  className={`absolute -left-[7px] top-2 h-3 w-3 rounded-full border-2 border-white shadow ${r.is_current ? "bg-orange-600 ring-2 ring-orange-200" : meta.dot}`}
                  aria-hidden
                />
                <div
                  className={`rounded-lg border p-2.5 transition-colors ${
                    r.is_current ? "border-orange-300 bg-orange-50/70" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-800">rev {r.revision}</span>
                    {r.is_current && (
                      <span className="text-[9px] font-black tracking-wider bg-orange-600 text-white rounded px-1 py-0.5">ATUAL</span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded border px-1.5 py-0.5 ${meta.color}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400">{timeAgo(r.saved_at)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
                    <span className="font-mono">{r.hash.slice(0, 8)}</span>
                    <span>· {r.element_count} el.</span>
                    {r.panel && (
                      <span className="inline-flex items-center gap-0.5">
                        <Monitor className="h-3 w-3" /> {r.panel.width}×{r.panel.height}
                      </span>
                    )}
                    {r.note && <span className="truncate max-w-full text-slate-400">· {r.note}</span>}
                  </div>
                  {!r.is_current && (
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] font-semibold border-slate-300 text-slate-600 hover:border-orange-400 hover:text-orange-700"
                        onClick={() => onCompare(r.revision)}
                        disabled={comparingRev !== null}
                        title="Mostrar diff desta revisão contra a atual no 3D"
                      >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompare className="h-3 w-3" />}
                        COMPARAR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] font-semibold border-slate-300 text-slate-600 hover:border-rose-400 hover:text-rose-700"
                        onClick={() => void restore(r.revision)}
                        disabled={restoring !== null || comparingRev !== null}
                        title="Restaurar este documento como nova revisão"
                      >
                        {restoring === r.revision ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        RESTAURAR
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] font-semibold border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-700"
                        onClick={() => void downloadDiffPdf(r.revision)}
                        disabled={pdfBusy !== null || comparingRev !== null}
                        title="Baixar relatório PDF de diferenças entre esta revisão e a atual"
                      >
                        {pdfBusy === r.revision ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                        PDF
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
