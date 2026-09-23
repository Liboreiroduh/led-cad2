"use client";

/**
 * MOBILE AI BAR — botões de ação rápida mapeados para a IA REAL do servidor
 * (provider Z.ai · glm-4.5v). Cada chip dispara um prompt pré-mapeado pelo
 * mesmo fluxo do copiloto: /api/ai/transform → preview 3D → APLICAR.
 * Aparece somente em telas < lg; desktop usa o dock lateral.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Lightbulb, Construction, Palette, Type, MoveHorizontal, Trash2, Sparkles, Loader2,
} from "lucide-react";

export interface QuickCmd {
  id: string;
  label: string;
  /** prompt pré-mapeado enviado EXATAMENTE como se o operador digitasse */
  prompt: string;
  icon: React.ReactNode;
  /** cor do ícone — sem azul/indigo (paleta do projeto) */
  tone: string;
}

export const QUICK_COMMANDS: QuickCmd[] = [
  {
    id: "lum",
    label: "Luminária",
    prompt: "adicione uma luminária LED no topo do painel central",
    icon: <Lightbulb className="h-4 w-4" />,
    tone: "text-amber-300",
  },
  {
    id: "esc",
    label: "Escada",
    prompt: "adicione uma escada de acesso com degraus no poste direito",
    icon: <Construction className="h-4 w-4" />,
    tone: "text-orange-300",
  },
  {
    id: "cor",
    label: "Cor",
    prompt: "mude a cor da estrutura metálica para azul escuro",
    icon: <Palette className="h-4 w-4" />,
    tone: "text-rose-300",
  },
  {
    id: "ren",
    label: "Renomear",
    prompt: "renomeie o painel para Painel Principal",
    icon: <Type className="h-4 w-4" />,
    tone: "text-emerald-300",
  },
  {
    id: "dim",
    label: "+20% largura",
    prompt: "aumente a largura do painel em 20% mantendo a altura",
    icon: <MoveHorizontal className="h-4 w-4" />,
    tone: "text-teal-300",
  },
  {
    id: "rem",
    label: "Remover",
    prompt: "remova o último elemento adicionado ao painel",
    icon: <Trash2 className="h-4 w-4" />,
    tone: "text-red-300",
  },
];

interface MobileAiBarProps {
  /** IA em execução (transform em curso) */
  busy: boolean;
  /** rótulo do provider/modelo ativo — exibido no chip IA para dar visibilidade */
  providerLabel: string;
  onQuick: (prompt: string, cmdId: string) => void;
  onOpenCopilot: () => void;
}

export function MobileAiBar({ busy, providerLabel, onQuick, onOpenCopilot }: MobileAiBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const [activeCmd, setActiveCmd] = useState<string | null>(null);
  const startRef = useRef<number>(0);

  // cronômetro de execução — feedback de que a IA REAL está trabalhando no servidor
  // (setState só dentro de timeout/interval — nunca direto no corpo do effect)
  useEffect(() => {
    if (!busy) return;
    startRef.current = Date.now();
    const tick = () => setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    const t0 = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [busy]);

  return (
    <section
      aria-label="Ações rápidas de IA"
      className="shrink-0 bg-[#141f2b] border-t border-slate-700/60"
    >
      {/* cabeçalho fino com o modelo ativo — prova visível de qual IA responde */}
      <div className="flex items-center gap-1.5 px-3 pt-1.5" aria-live="polite">
        <Sparkles className="h-3 w-3 text-orange-400" aria-hidden />
        <span className="text-[9.5px] font-bold tracking-widest text-slate-400">
          IA NO SERVIDOR · {providerLabel.toUpperCase()}
        </span>
        {busy && (
          <motion.span
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-orange-500/15 border border-orange-500/40 px-2 py-0.5 text-[9.5px] font-bold text-orange-300 whitespace-nowrap"
          >
            <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
            PROCESSANDO · {elapsed}s
          </motion.span>
        )}
      </div>

      {/* chips de ação — snap horizontal, alvos de toque ≥44px */}
      <div
        className="flex items-stretch gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="toolbar"
        aria-label="Comandos rápidos da IA"
      >
        {/* chip principal: abre o copiloto para pedido livre */}
        <button
          type="button"
          onClick={onOpenCopilot}
          disabled={busy}
          aria-label="Abrir copiloto IA para pedido livre"
          className="shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-gradient-to-r from-orange-600 to-amber-500 text-white text-xs font-black tracking-wide shadow-lg shadow-orange-950/40 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-orange-300 outline-none"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          IA LIVRE
        </button>

        {QUICK_COMMANDS.map((cmd) => {
          const isActive = busy && activeCmd === cmd.id;
          return (
            <button
              key={cmd.id}
              type="button"
              disabled={busy}
              aria-busy={isActive}
              title={cmd.prompt}
              onClick={() => {
                setActiveCmd(cmd.id);
                onQuick(cmd.prompt, cmd.id);
              }}
              className={`shrink-0 snap-start inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full border text-xs font-bold bg-slate-800/90 border-slate-600 text-slate-100 transition-all active:scale-95 disabled:opacity-45 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-orange-300 outline-none ${
                isActive ? "!border-orange-400 !bg-orange-500/20 ring-1 ring-orange-400/60" : "hover:border-slate-400"
              }`}
            >
              <span className={isActive ? "text-orange-300" : cmd.tone} aria-hidden>
                {isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : cmd.icon}
              </span>
              {cmd.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
