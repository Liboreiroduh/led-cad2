"use client";

/**
 * GERENCIADOR DE EXEMPLOS FEW-SHOT — lista os exemplos salvos em data/examples,
 * mostra metadados (pedido, elementos antes→depois, tamanho) e permite remover.
 * few-shot §25: exemplos salvos são injetados como referência nas próximas transformações.
 */
import { useCallback, useState } from "react";
import { GraduationCap, Trash2, Loader2, ChevronDown, ChevronUp, RefreshCw, Database } from "lucide-react";
import { api, ApiCallError } from "@/lib/cad/client-api";
import { toast } from "sonner";

interface ExampleItem {
  id: string;
  request: string;
  operator_note: string;
  saved_at: string;
  before_elements: number;
  after_elements: number;
  size_bytes: number;
}

export function ExamplesManager({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ExampleItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listExamples();
      setItems(r.examples);
    } catch (e) {
      toast.error((e as ApiCallError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) void load();
  };

  const remove = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmId(null);
    setDeletingId(id);
    try {
      await api.deleteExample(id);
      setItems((arr) => (arr ? arr.filter((x) => x.id !== id) : arr));
      toast.success("Exemplo removido");
    } catch (e) {
      toast.error((e as ApiCallError).payload?.message ?? (e as ApiCallError).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-slate-50/70">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-violet-700 transition-colors"
        title="Exemplos few-shot salvos (usados como referência nas transformações)"
      >
        <GraduationCap className="h-3.5 w-3.5 text-violet-500" />
        EXEMPLOS FEW-SHOT
        {items !== null && items.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-violet-100 border border-violet-200 text-violet-700 px-1.5 text-[10px] font-bold">
            {items.length}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-slate-400">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando exemplos…
            </div>
          ) : !items?.length ? (
            <div className="text-[11px] text-slate-500 py-2 leading-relaxed">
              Nenhum exemplo salvo. Aplique uma transformação da IA e use{" "}
              <span className="inline-flex items-center gap-0.5 font-medium text-slate-600">
                <GraduationCap className="h-3 w-3" /> salvar como exemplo
              </span>{" "}
              no card do histórico.
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-1">
                <button
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-violet-600 transition-colors"
                  title="Recarregar lista"
                  aria-label="Recarregar exemplos"
                >
                  <RefreshCw className="h-3 w-3" /> atualizar
                </button>
              </div>
              <ul className="space-y-1.5 max-h-44 overflow-y-auto cad-scroll pr-0.5" aria-label="Exemplos salvos">
                {items.map((ex) => (
                  <li
                    key={ex.id}
                    className="group rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 hover:border-violet-300 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <Database className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-400" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-700 leading-snug line-clamp-2" title={ex.request}>
                          {ex.request}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                          <span>{new Date(ex.saved_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}{" "}
                            {new Date(ex.saved_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span>
                            {ex.before_elements}→{ex.after_elements} el.
                          </span>
                          <span>{(ex.size_bytes / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                      <button
                        onClick={() => void remove(ex.id)}
                        disabled={deletingId === ex.id}
                        aria-label={confirmId === ex.id ? `Confirmar remoção do exemplo` : `Remover exemplo`}
                        title={confirmId === ex.id ? "Clique novamente para confirmar" : "Remover exemplo"}
                        className={`shrink-0 h-6 w-6 grid place-items-center rounded-md border transition-colors ${
                          confirmId === ex.id
                            ? "bg-red-600 border-red-600 text-white"
                            : "border-transparent text-slate-300 hover:text-red-600 hover:border-red-200 group-hover:text-slate-400"
                        }`}
                      >
                        {deletingId === ex.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                O exemplo mais recente compatível é injetado como referência de formato (few-shot) nas transformações.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
