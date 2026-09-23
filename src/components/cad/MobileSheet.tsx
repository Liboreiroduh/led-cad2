"use client";

/**
 * MOBILE SHEET — bottom sheet do dock em telas < lg.
 * Barra de navegação fixa no rodapé (alvos ≥48px, safe-area iOS) + painel
 * que desliza com spring. Tocar na aba ativa colapsa; tocar em outra abre.
 * O conteúdo é o MESMO CopilotDock do desktop (fonte única de funcionalidade).
 */
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles, Braces, FileJson, ListTree, History, ChevronDown,
} from "lucide-react";
import type { DockTab } from "@/components/cad/CopilotDock";

const TABS: Array<[DockTab, string, React.ReactNode]> = [
  ["copiloto", "IA", <Sparkles key="i" className="h-5 w-5" />],
  ["elementos", "Elementos", <ListTree key="i" className="h-5 w-5" />],
  ["historico", "Histórico", <History key="i" className="h-5 w-5" />],
  ["json", "JSON", <Braces key="i" className="h-5 w-5" />],
  ["presets", "Presets", <FileJson key="i" className="h-5 w-5" />],
];

/** altura do painel expandido — deixa viewport enxergar o preview 3D acima */
const SHEET_H = "46vh";

interface MobileSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tab: DockTab;
  onTabChange: (t: DockTab) => void;
  /** badge opcional na aba IA (ex.: candidato pendente) */
  badge?: string | null;
  children: React.ReactNode;
}

export function MobileSheet({ open, onOpenChange, tab, onTabChange, badge, children }: MobileSheetProps) {
  return (
    <div className="lg:hidden shrink-0 flex flex-col" data-mobile-sheet>
      {/* ---------- PAINEL DESLIZANTE ---------- */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sheet"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: SHEET_H, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="overflow-hidden bg-white shadow-[0_-10px_36px_rgba(2,6,23,0.35)]"
            role="region"
            aria-label="Painel do copiloto"
          >
            {/* alça — toque para colapsar */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Colapsar painel"
              className="sticky top-0 z-10 flex w-full items-center justify-center bg-white/95 backdrop-blur pt-1.5 pb-1 focus-visible:ring-2 focus-visible:ring-orange-400 outline-none"
            >
              <span className="h-1.5 w-12 rounded-full bg-slate-300" aria-hidden />
            </button>
            <div className="h-[calc(46vh-18px)] min-h-[220px] flex flex-col overflow-hidden">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- BARRA DE NAVEGAÇÃO (sempre visível) ---------- */}
      <nav
        aria-label="Navegação mobile"
        className="grid grid-cols-6 items-stretch bg-[#141f2b] border-t border-slate-700/60 pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(([id, label, icon]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (active && open) {
                  onOpenChange(false); // 2º toque na aba ativa colapsa
                } else {
                  onTabChange(id);
                  onOpenChange(true);
                }
              }}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] text-[9px] font-bold tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400 outline-none ${
                active ? "text-orange-400 bg-slate-800/60" : "text-slate-400 hover:text-slate-200 active:bg-slate-800"
              }`}
            >
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-500" aria-hidden />}
              <span className="relative" aria-hidden>
                {icon}
                {id === "copiloto" && badge && (
                  <span className="absolute -top-1 -right-2 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-orange-500 px-0.5 text-[8px] font-black text-white">
                    {badge}
                  </span>
                )}
              </span>
              <span className="leading-none">{label.toUpperCase()}</span>
            </button>
          );
        })}
        {/* colapsar/expandir */}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-label={open ? "Colapsar painel" : "Expandir painel"}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[52px] text-slate-400 hover:text-slate-200 active:bg-slate-800 transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400 outline-none"
        >
          <motion.span animate={{ rotate: open ? 0 : 180 }} transition={{ duration: 0.2 }} aria-hidden>
            <ChevronDown className="h-5 w-5" />
          </motion.span>
          <span className="text-[9px] font-bold leading-none">{open ? "FECHAR" : "ABRIR"}</span>
        </button>
      </nav>
    </div>
  );
}
