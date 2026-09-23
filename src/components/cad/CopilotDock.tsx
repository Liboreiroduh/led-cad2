"use client";

/**
 * DOCK COPILOTO IA — 3 abas: Copiloto (chat), JSON DO PROJETO (editor), Presets.
 * Chips contextuais só preenchem a instrução textual — nunca executam handlers ocultos.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Send, Paperclip, Copy, CheckCircle2, AlertTriangle, Info, FileJson,
  Save, Loader2, RotateCcw, Download, Upload, Braces, Sparkles, Trash2, Move, Replace, CopyPlus, ListTree, History, GraduationCap, ImageOff,
} from "lucide-react";
import { api, ApiCallError } from "@/lib/cad/client-api";
import type { Assumption, ProjectDocument, ProjectDiff } from "@/lib/cad/schema";
import type { HistoryItem } from "./types";
import { ElementBrowser } from "./ElementBrowser";
import { RevisionHistory } from "./RevisionHistory";
import { ExamplesManager } from "./ExamplesManager";
import { toast } from "sonner";

export type DockTab = "copiloto" | "json" | "presets" | "elementos" | "historico";

interface CopilotDockProps {
  tab: DockTab;
  onTabChange: (t: DockTab) => void;
  history: HistoryItem[];
  sending: boolean;
  onSend: (text: string, attachments: Array<{ type: "image"; name: string; data_url: string }>) => void;
  project: ProjectDocument;
  projectKey: string;
  onPreviewCandidate: (candidate: ProjectDocument) => Promise<{ ok: boolean; errors?: Array<{ path: string; message: string }>; warnings?: Array<{ path: string; message: string }>; diffSummary?: string }>;
  selectedElement: ProjectDocument["elements"][number] | null;
  activeProviderLabel: string;
  /** modelo ativo aceita imagem? (false → avisa ao anexar croqui) */
  activeVision?: boolean;
  onOpenProviders: () => void;
  onOpenJsonTab: () => void;
  onAppliedCandidate: () => void;
  /** element browser */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hiddenIds: Set<string>;
  onToggleHidden: (id: string) => void;
  onIsolateGroup: (group: string | null) => void;
  isolatedGroup: string | null;
  onFocusElement: (id: string) => void;
  candidateDoc: ProjectDocument | null;
  /** histórico de revisões */
  comparingRev: number | null;
  onCompareRevision: (rev: number) => void;
  historyRefreshKey: number;
  onRevisionRestored: () => void;
}

function assumptionText(a: Assumption): string {
  return typeof a === "string" ? a : `${a.detail} (${a.path}${a.review_required ? " · revisar" : ""})`;
}

export function CopilotDock(props: CopilotDockProps) {
  const { tab } = props;
  return (
    <aside className="flex flex-col h-full w-full bg-white border-l border-slate-200" aria-label="Dock Copiloto IA">
      <div className="flex items-stretch border-b border-slate-200 bg-slate-800 text-slate-200" role="tablist" aria-label="Abas do dock">
        {(
          [
            ["copiloto", "Copiloto", <Sparkles key="i" className="h-3.5 w-3.5" />],
            ["json", "JSON", <Braces key="i" className="h-3.5 w-3.5" />],
            ["presets", "Presets", <FileJson key="i" className="h-3.5 w-3.5" />],
            ["elementos", "Elem.", <ListTree key="i" className="h-3.5 w-3.5" />],
            ["historico", "Hist.", <History key="i" className="h-3.5 w-3.5" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => props.onTabChange(id as DockTab)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold tracking-wide transition-colors ${
              tab === id ? "bg-white text-slate-900 border-b-2 border-orange-500" : "hover:bg-slate-700"
            }`}
          >
            {icon}
            {label.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === "copiloto" && <CopilotTab {...props} />}
      {tab === "json" && <JsonTab {...props} />}
      {tab === "presets" && <PresetsTab {...props} />}
      {tab === "historico" && (
        <RevisionHistory
          comparingRev={props.comparingRev}
          onCompare={props.onCompareRevision}
          refreshKey={props.historyRefreshKey}
          onRestored={props.onRevisionRestored}
        />
      )}
      {tab === "elementos" && (
        <ElementBrowser
          project={props.project}
          candidate={props.candidateDoc}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          hiddenIds={props.hiddenIds}
          onToggleHidden={props.onToggleHidden}
          onIsolateGroup={props.onIsolateGroup}
          isolatedGroup={props.isolatedGroup}
          onFocus={props.onFocusElement}
        />
      )}
    </aside>
  );
}

/* ============================= COPILOTO ============================= */

function CopilotTab(props: CopilotDockProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ type: "image"; name: string; data_url: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [props.history, props.sending]);

  const submit = () => {
    const text = input.trim();
    if (!text || props.sending) return;
    props.onSend(text, attachments);
    setInput("");
    setAttachments([]);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Array<{ type: "image"; name: string; data_url: string }> = [];
    for (const f of Array.from(files).slice(0, 3)) {
      if (!f.type.startsWith("image/")) continue;
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(f);
      });
      next.push({ type: "image", name: f.name, data_url: dataUrl });
    }
    setAttachments((a) => [...a, ...next].slice(0, 3));
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto cad-scroll p-3 space-y-3 min-h-0">
        {props.history.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white p-4 text-xs text-slate-500 leading-relaxed">
            <p className="font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-orange-600" /> A IA escreve o documento inteiro.
            </p>
            <p>Descreva a estrutura desejada. O sistema valida o JSON, calcula o diff e mostra o preview 3D antes de aplicar.</p>
            <div className="mt-2.5 flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Experimente:</span>
              {[
                "remova os postes e use sustentação de parede",
                "adicione cabo de fixação por coluna",
                "adicione uma escada de acesso no poste direito",
              ].map((ex) => (
                <button
                  key={ex}
                  onClick={() => setInput(ex)}
                  className="text-left truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-800 transition-colors"
                  title="Clique para preencher o campo de pedido"
                >
                  “{ex}”
                </button>
              ))}
            </div>
            <p className="mt-2.5 flex items-start gap-1.5 text-slate-400">
              <GraduationCap className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-500" />
              Exemplos salvos com “salvar como exemplo” viram referência few-shot nas próximas transformações.
            </p>
          </div>
        )}
        {props.history.map((h) => (
          <HistoryCard key={h.id} item={h} onSaveExample={(it) => saveExampleFromHistory(it, props.project)} />
        ))}
        {props.sending && (
          <div className="relative flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-hidden">
            <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
            A IA está reescrevendo o documento completo… (pode levar até 1 min)
            <div className="absolute bottom-0 left-0 h-0.5 w-full cad-shimmer-bar" aria-hidden />
          </div>
        )}
      </div>

      {props.selectedElement && (
        <div className="border-t border-slate-200 bg-orange-50/60 px-3 pt-2 pb-1">
          <div className="text-[11px] font-semibold text-orange-800 mb-1.5 truncate">
            selecionado: {props.selectedElement.id} · {props.selectedElement.type} · {props.selectedElement.role}
            {props.selectedElement.type === "beam" && ` · ${(props.selectedElement as { profile?: string }).profile ?? ""}`}
          </div>
          <div className="flex flex-wrap gap-1.5 pb-1.5">
            <Chip icon={<CopyPlus className="h-3 w-3" />} label="duplicar" onClick={() => setInput(`Duplique o elemento ${props.selectedElement!.id} mantendo o alinhamento com o painel e ajustando IDs.`)} />
            <Chip icon={<Move className="h-3 w-3" />} label="mover" onClick={() => setInput(`Mova o elemento ${props.selectedElement!.id} e informe o deslocamento desejado (mm em X/Y/Z).`)} />
            <Chip icon={<Replace className="h-3 w-3" />} label="trocar perfil" onClick={() => setInput(`Troque o perfil do elemento ${props.selectedElement!.id} para um perfil do catálogo adequado ao esforço.`)} />
            <Chip icon={<Copy className="h-3 w-3" />} label="adicionar paralelo" onClick={() => setInput(`Adicione um elemento paralelo ao ${props.selectedElement!.id}, afastado simetricamente na estrutura.`)} />
            <Chip icon={<Trash2 className="h-3 w-3" />} label="excluir" onClick={() => setInput(`Exclua o elemento ${props.selectedElement!.id} e remova o que depender dele, preservando a coerência estrutural.`)} />
          </div>
        </div>
      )}

      <ExamplesManager />

      <div className="border-t border-slate-200 p-3 space-y-2">
        {attachments.length > 0 && props.activeVision === false && (
          <button
            onClick={props.onOpenProviders}
            className="w-full flex items-center gap-2 text-left text-[11px] bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-2.5 py-2 hover:bg-amber-100 transition-colors"
            role="alert"
          >
            <ImageOff className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="min-w-0">
              <span className="font-semibold">Modelo ativo não processa imagens.</span> O anexo será rejeitado — troque para um modelo vision (ex.: glm-4.5v).
            </span>
          </button>
        )}
        {attachments.length > 0 && (
          <div className="flex gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                <img src={a.data_url} alt={a.name} className="h-12 w-12 object-cover rounded border border-slate-300" />
                <button
                  onClick={() => setAttachments((arr) => arr.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white rounded-full h-4 w-4 text-[10px] leading-none"
                  aria-label={`remover anexo ${a.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Descreva a alteração desejada… (Enter envia)"
          className="min-h-[64px] max-h-32 text-sm"
          aria-label="Instrução para a IA"
        />
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
          <Button variant="outline" size="icon" onClick={() => fileRef.current?.click()} aria-label="Anexar imagem" title="Anexar imagem/croqui">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button onClick={submit} disabled={props.sending || !input.trim()} className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold" aria-label="Enviar pedido para a IA">
            {props.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            ENVIAR
          </Button>
        </div>
        <button onClick={props.onOpenProviders} className="w-full text-left text-[11px] text-slate-500 hover:text-orange-700 transition-colors truncate" title="Abrir conector de IA">
          IA ativa: {props.activeProviderLabel}
          {props.activeVision === false ? " · sem visão" : ""} <span className="underline">trocar</span>
        </button>
      </div>
    </>
  );
}

async function saveExampleFromHistory(item: HistoryItem, before: ProjectDocument) {
  try {
    await api.saveExample({
      request: item.text,
      before,
      after: item.meta?.candidate ?? null,
      operator_note: item.meta?.diffSummary ?? "",
    });
    toast.success("Exemplo salvo em data/examples");
  } catch (e) {
    toast.error((e as ApiCallError).message);
  }
}

function Chip({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-white px-2 py-0.5 text-[11px] font-medium text-orange-800 hover:bg-orange-100 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

function HistoryCard({ item, onSaveExample }: { item: HistoryItem; onSaveExample: (i: HistoryItem) => void }) {
  if (item.role === "user") {
    return (
      <div className="ml-6 rounded-lg bg-slate-800 text-slate-50 p-3 text-sm">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">você · {new Date(item.ts).toLocaleTimeString("pt-BR")}</div>
        {item.text}
      </div>
    );
  }
  if (item.role === "error") {
    return (
      <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">
        <div className="flex items-center gap-1.5 font-semibold mb-1">
          <AlertTriangle className="h-4 w-4" /> {item.meta?.errorType ?? "erro"}
        </div>
        {item.text}
      </div>
    );
  }
  if (item.role === "info") {
    return (
      <div className="rounded-lg border-l-4 border-slate-400 bg-slate-50 p-3 text-xs text-slate-600">
        <div className="flex items-center gap-1.5 font-semibold mb-0.5">
          <Info className="h-3.5 w-3.5" /> sistema
        </div>
        {item.text}
      </div>
    );
  }
  // assistant
  const m = item.meta ?? {};
  return (
    <div className={`rounded-lg border-l-4 p-3 text-sm ${m.status === "needs_input" ? "border-amber-500 bg-amber-50" : "border-green-600 bg-green-50/70"}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {m.status === "needs_input" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-700" />}
          {m.status === "needs_input" ? "precisa de input" : "candidato pronto"}
        </span>
        {m.provider && (
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            {m.provider} · {m.model} · {((m.latency ?? 0) / 1000).toFixed(1)}s
            {!!m.fewShot && (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200 px-1 font-semibold"
                title={`usou exemplo few-shot salvo pelo operador${typeof m.fewShotScore === "number" ? ` · relevância ${(m.fewShotScore * 100).toFixed(0)}%` : ""}`}
              >
                <GraduationCap className="h-3 w-3" /> few-shot{typeof m.fewShotScore === "number" ? ` ${(m.fewShotScore * 100).toFixed(0)}%` : ""}
              </span>
            )}
          </span>
        )}
      </div>
      {(m.explain || item.text) && <p className="text-slate-700">{m.explain || item.text}</p>}
      {!!m.diffSummary && m.diffSummary !== "nenhuma alteração de elementos" && (
        <Badge className="mt-2 bg-orange-600 hover:bg-orange-600">{m.diffSummary}</Badge>
      )}
      {!!m.applied && <Badge className="mt-2 ml-1 bg-green-700">aplicado</Badge>}
      {!!m.assumptions?.length && (
        <ul className="mt-2 list-disc list-inside text-xs text-slate-600 space-y-0.5">
          {m.assumptions.map((a, i) => (
            <li key={i}>{assumptionText(a)}</li>
          ))}
        </ul>
      )}
      {!!m.questions?.length && (
        <div className="mt-2 text-xs text-amber-800">
          <div className="font-semibold mb-0.5">Perguntas:</div>
          <ul className="list-decimal list-inside space-y-0.5">
            {m.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {!!m.candidate && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 text-xs"
          onClick={() => onSaveExample(item)}
          title="Salva antes→depois desta transformação como referência few-shot (data/examples)"
        >
          <Save className="h-3 w-3 mr-1" /> salvar como exemplo{m.applied ? " · aplicada" : ""}
        </Button>
      )}
    </div>
  );
}

/* ============================= JSON TAB ============================= */

function JsonTab(props: CopilotDockProps) {
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [warnings, setWarnings] = useState<Array<{ path: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(JSON.stringify(props.project, null, 2));
    setIssues([]);
    setWarnings([]);
  }, [props.projectKey]);

  const parse = (): ProjectDocument | null => {
    try {
      return JSON.parse(text) as ProjectDocument;
    } catch (e) {
      setIssues([{ path: "JSON", message: (e as Error).message }]);
      return null;
    }
  };

  const validate = async () => {
    const doc = parse();
    if (!doc) return;
    setBusy(true);
    try {
      const r = await props.onPreviewCandidate(doc);
      setIssues(r.errors ?? []);
      setWarnings(r.warnings ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5 p-2 border-b border-slate-200">
        <Button size="sm" variant="outline" onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
          Formatar
        </Button>
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("JSON copiado"))}>
          <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
        </Button>
        <Button size="sm" variant="outline" onClick={() => setText(JSON.stringify(props.project, null, 2))}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restaurar
        </Button>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
              e.target.value = "";
            }}
          />
          <span className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent">
            <Upload className="h-3.5 w-3.5 mr-1" /> Importar
          </span>
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void api.downloadJson().catch((e: ApiCallError) => toast.error(e.message))}
        >
          <Download className="h-3.5 w-3.5 mr-1" /> Exportar
        </Button>
        <Button size="sm" onClick={validate} disabled={busy} className="ml-auto bg-orange-600 hover:bg-orange-700 text-white">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
          Validar + Pré-visualizar
        </Button>
      </div>
      <div className="flex-1 min-h-0 p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Editor JSON do projeto"
          className="w-full h-full resize-none rounded-md border border-slate-300 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-emerald-100 cad-scroll focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </div>
      {(issues.length > 0 || warnings.length > 0) && (
        <div className="max-h-40 overflow-y-auto cad-scroll border-t border-slate-200 p-2 space-y-1">
          {issues.map((i, k) => (
            <div key={`e${k}`} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
              <b>{i.path}</b>: {i.message}
            </div>
          ))}
          {warnings.map((i, k) => (
            <div key={`w${k}`} className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              <b>{i.path}</b>: {i.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ============================= PRESETS TAB ============================= */

function PresetsTab(props: CopilotDockProps) {
  const [refs, setRefs] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [custom, setCustom] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.listPresets();
      setRefs(r.references);
      setCustom(r.custom);
    } catch (e) {
      toast.error((e as ApiCallError).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadPreset = async (id: string) => {
    setBusyId(id);
    try {
      await api.loadPreset(id);
      toast.success(`Preset ${id} carregado`);
      props.onAppliedCandidate();
    } catch (e) {
      toast.error((e as ApiCallError).message);
    } finally {
      setBusyId(null);
    }
  };

  const saveAsPreset = async () => {
    if (!savingName.trim()) return;
    try {
      await api.saveCustomPreset(props.project, savingName.trim(), "Salvo pelo operador");
      setSavingName("");
      toast.success("Preset customizado salvo");
      void load();
    } catch (e) {
      toast.error((e as ApiCallError).message);
    }
  };

  const Card = ({ p }: { p: { id: string; name: string; description: string } }) => (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="font-semibold text-sm text-slate-800">{p.name}</div>
      <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{p.description}</div>
      <Button size="sm" variant="outline" className="mt-2 w-full h-7 text-xs" onClick={() => void loadPreset(p.id)} disabled={busyId === p.id}>
        {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
        CARREGAR
      </Button>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto cad-scroll p-3 space-y-3 min-h-0">
      {loading && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> carregando presets…</div>}
      {!loading && (
        <>
          <div className="text-[11px] font-semibold tracking-wide text-slate-500">PRESETS DE REFERÊNCIA — JSON completos</div>
          <div className="grid grid-cols-1 gap-2">
            {refs.map((p) => (
              <Card key={p.id} p={p} />
            ))}
          </div>
          {custom.length > 0 && (
            <>
              <Separator />
              <div className="text-[11px] font-semibold tracking-wide text-slate-500">CUSTOMIZADOS</div>
              <div className="grid grid-cols-1 gap-2">
                {custom.map((p) => (
                  <Card key={p.id} p={p} />
                ))}
              </div>
            </>
          )}
          <Separator />
          <div className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wide text-slate-500">SALVAR PROJETO ATUAL COMO PRESET</div>
            <div className="flex gap-2">
              <Input value={savingName} onChange={(e) => setSavingName(e.target.value)} placeholder="nome do preset" className="h-8 text-xs" />
              <Button size="sm" onClick={() => void saveAsPreset()} disabled={!savingName.trim()} className="bg-slate-800 hover:bg-slate-700 text-white">
                <Save className="h-3.5 w-3.5 mr-1" /> Salvar
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
