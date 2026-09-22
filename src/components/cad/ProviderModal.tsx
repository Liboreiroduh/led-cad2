"use client";

/**
 * CONECTOR DE IA — modal de providers (§12).
 * Gemini e Z.ai com modelo configurável + API Key (fica só no backend) + ATIVAR/teste.
 * Mostra CONEXÕES SALVAS e provider ativo.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, ApiCallError } from "@/lib/cad/client-api";
import { toast } from "sonner";

interface ProviderState {
  model: string;
  api_key_masked: string;
  configured: boolean;
  timeout_ms?: number;
}

interface ConfigShape {
  active_provider: string;
  providers: Record<string, ProviderState>;
}

interface ProviderMeta {
  id: "gemini" | "zai" | "mock";
  label: string;
  models: string[];
  needsKey: boolean;
  hint: string;
}

const PROVIDERS: ProviderMeta[] = [
  { id: "gemini", label: "Google Gemini", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash"], needsKey: true, hint: "API Key do Google AI Studio — armazenada apenas no backend local." },
  { id: "zai", label: "Z.ai", models: ["glm-4.5-flash", "glm-4.5-air", "glm-4.5", "glm-4.5v"], needsKey: false, hint: "GLM nativo (SDK backend). Para anexos de imagem use glm-4.5v." },
];

export function ProviderModal({
  open,
  onOpenChange,
  onActivated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onActivated: () => void;
}) {
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string }>>({});

  const load = async () => {
    try {
      const cfg = await api.aiConfig();
      setConfig(cfg);
    } catch (e) {
      toast.error((e as ApiCallError).message);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const activate = async (id: "gemini" | "zai" | "mock", setActive: boolean) => {
    setBusy(id);
    try {
      if (id !== "mock") {
        await api.saveAiConfig({ target: id, model: config?.providers[id]?.model, api_key: keys[id] || undefined });
      }
      if (id !== "mock") {
        const t = await api.testProvider(id);
        setStatus((s) => ({ ...s, [id]: { ok: true, text: `${id} ativo — modelo ${t.model} — respondeu em ${(t.latency_ms / 1000).toFixed(2)}s` } }));
      } else {
        setStatus((s) => ({ ...s, [id]: { ok: true, text: "Modo mock ativo — transformador local (sem API)." } }));
      }
      if (setActive) {
        await api.saveAiConfig({ provider: id });
        toast.success(`${id.toUpperCase()} definido como IA ativa`);
      }
      await load();
      onActivated();
    } catch (e) {
      const err = e as ApiCallError;
      setStatus((s) => ({ ...s, [id]: { ok: false, text: err.payload?.message ?? err.message } }));
      toast.error(err.payload?.message ?? "Falha ao ativar provider");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-800">Conector de IA</DialogTitle>
          <DialogDescription>
            Os providers são intercambiáveis — todos devolvem o mesmo contrato de documento. As chaves ficam somente no backend local.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {PROVIDERS.map((p) => {
            const st = config?.providers[p.id];
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-800">{p.label}</div>
                  {config?.active_provider === p.id && <Badge className="bg-green-600">ATIVO</Badge>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">Modelo</label>
                    <Select
                      value={st?.model ?? p.models[0]}
                      onValueChange={(v) =>
                        setConfig((c) =>
                          c ? { ...c, providers: { ...c.providers, [p.id]: { ...c.providers[p.id], model: v } } } : c,
                        )
                      }
                    >
                      <SelectTrigger aria-label={`Modelo ${p.label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {p.models.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">API Key {st?.api_key_masked ? `(salva: ${st.api_key_masked})` : ""}</label>
                    <Input
                      type="password"
                      placeholder={p.needsKey ? "cole a API key…" : "opcional (SDK nativo)"}
                      value={keys[p.id] ?? ""}
                      onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                      aria-label={`API Key ${p.label}`}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => activate(p.id, true)} disabled={busy === p.id} className="bg-orange-600 hover:bg-orange-700 text-white">
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                    ATIVAR {p.label.toUpperCase()}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => activate(p.id, false)} disabled={busy === p.id}>
                    Testar conexão
                  </Button>
                  <span className="text-xs text-slate-400">{p.hint}</span>
                </div>
                {status[p.id] && (
                  <div className={`flex items-center gap-2 text-xs ${status[p.id].ok ? "text-green-700" : "text-red-600"}`}>
                    {status[p.id].ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {status[p.id].text}
                  </div>
                )}
              </div>
            );
          })}

          <Separator />

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-700">Mock (dev)</div>
              {config?.active_provider === "mock" && <Badge className="bg-green-600">ATIVO</Badge>}
            </div>
            <p className="text-xs text-slate-500">
              Transformador determinístico local — valida todo o fluxo JSON → diff → preview → apply sem nenhuma API key.
            </p>
            <Button size="sm" variant="outline" onClick={() => activate("mock", true)} disabled={busy === "mock"}>
              ATIVAR MOCK
            </Button>
            {status.mock && <div className="text-xs text-green-700">{status.mock.text}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-500 mb-2">CONEXÕES SALVAS</div>
            <div className="flex flex-wrap gap-2">
              {config
                ? Object.entries(config.providers).map(([id, p]) => (
                    <Badge key={id} variant={p.configured ? "default" : "outline"} className={p.configured ? "bg-slate-700" : ""}>
                      {id} · {p.model}
                      {p.api_key_masked ? ` · ${p.api_key_masked}` : ""}
                      {config.active_provider === id ? " · ativa" : ""}
                    </Badge>
                  ))
                : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
