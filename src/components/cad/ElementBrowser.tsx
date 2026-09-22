"use client";

/**
 * ELEMENT BROWSER — árvore de elementos agrupada por `group`.
 * Busca, toggle de visibilidade (olho), isolar grupo e localizar (foco de câmera).
 * Somente leitura/visual: edições continuam sendo feitas pela IA/JSON (documento é a autoridade).
 */
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Crosshair, Layers, Search, Boxes } from "lucide-react";
import type { ProjectDocument } from "@/lib/cad/schema";

export interface ElementBrowserProps {
  project: ProjectDocument;
  candidate: ProjectDocument | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hiddenIds: Set<string>;
  onToggleHidden: (id: string) => void;
  onIsolateGroup: (group: string | null) => void;
  isolatedGroup: string | null;
  onFocus: (id: string) => void;
}

const TYPE_ICON: Record<string, string> = {
  beam: "▬",
  plate: "▤",
  bolt: "⬤",
  panel: "▣",
  cable: "⟋",
  surface: "◇",
};

export function ElementBrowser(props: ElementBrowserProps) {
  const doc = props.candidate ?? props.project;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, typeof doc.elements>();
    for (const el of doc.elements) {
      if (props.isolatedGroup && el.group !== props.isolatedGroup) continue;
      if (
        q &&
        !`${el.id} ${el.type} ${el.role} ${el.group} ${"profile" in el ? el.profile : ""}`.toLowerCase().includes(q)
      ) {
        continue;
      }
      const list = map.get(el.group) ?? [];
      list.push(el);
      map.set(el.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [doc, query, props.isolatedGroup]);

  const totalVisible = groups.reduce((n, [, els]) => n + els.length, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2.5 space-y-2 border-b border-slate-200">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="buscar id, tipo, role, perfil…"
            className="h-8 text-xs pl-7"
            aria-label="Buscar elementos"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Boxes className="h-3.5 w-3.5" />
          {totalVisible} de {doc.elements.length} elementos
          {props.candidate && <span className="text-orange-600 font-semibold ml-1">· preview</span>}
          {props.isolatedGroup && (
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[10px]" onClick={() => props.onIsolateGroup(null)}>
              mostrar todos
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto cad-scroll p-2 space-y-1.5 min-h-0">
        {groups.length === 0 && (
          <div className="text-xs text-slate-400 text-center py-8">nenhum elemento encontrado</div>
        )}
        {groups.map(([group, els]) => {
          const isCollapsed = collapsed.has(group);
          const hiddenCount = els.filter((e) => props.hiddenIds.has(e.id)).length;
          return (
            <div key={group} className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1.5">
                <button
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(group)) n.delete(group);
                      else n.add(group);
                      return n;
                    })
                  }
                  className="text-[10px] text-slate-400 w-3"
                  aria-label={`expandir grupo ${group}`}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <Layers className="h-3 w-3 text-orange-600" />
                <button
                  onClick={() => props.onIsolateGroup(props.isolatedGroup === group ? null : group)}
                  className={`text-[11px] font-bold truncate hover:text-orange-700 transition-colors ${props.isolatedGroup === group ? "text-orange-700" : "text-slate-700"}`}
                  title="isolar este grupo"
                >
                  {group}
                </button>
                <span className="text-[10px] text-slate-400">{els.length}</span>
                {hiddenCount > 0 && (
                  <span className="text-[10px] text-amber-600" title="ocultos">
                    ({hiddenCount} ocultos)
                  </span>
                )}
                <div className="ml-auto flex gap-0.5">
                  <button
                    onClick={() => {
                      const allHidden = els.every((e) => props.hiddenIds.has(e.id));
                      els.forEach((e) => {
                        if (allHidden === props.hiddenIds.has(e.id)) props.onToggleHidden(e.id);
                      });
                    }}
                    className="p-0.5 text-slate-400 hover:text-slate-700"
                    title="alternar visibilidade do grupo"
                    aria-label={`alternar visibilidade do grupo ${group}`}
                  >
                    {hiddenCount === els.length ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <ul className="divide-y divide-slate-100">
                  {els.map((el) => {
                    const hidden = props.hiddenIds.has(el.id);
                    const selected = props.selectedId === el.id;
                    return (
                      <li
                        key={el.id}
                        className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer transition-colors ${
                          selected ? "bg-orange-50 border-l-2 border-orange-500" : "hover:bg-slate-50 border-l-2 border-transparent"
                        }`}
                        onClick={() => props.onSelect(selected ? null : el.id)}
                      >
                        <span className="w-4 text-center text-slate-400" aria-hidden>
                          {TYPE_ICON[el.type] ?? "•"}
                        </span>
                        <span className={`font-semibold font-mono truncate ${hidden ? "text-slate-300 line-through" : "text-slate-800"}`}>
                          {el.id}
                        </span>
                        <span className="text-slate-400 truncate">{el.role}</span>
                        {"profile" in el && el.profile ? (
                          <span className="ml-auto text-[10px] text-slate-400 font-mono truncate max-w-24" title={el.profile}>
                            {el.profile}
                          </span>
                        ) : null}
                        <div className="ml-auto flex gap-0.5 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onFocus(el.id);
                            }}
                            className="p-0.5 text-slate-300 hover:text-orange-600 transition-colors"
                            title="localizar (foco de câmera)"
                            aria-label={`localizar ${el.id}`}
                          >
                            <Crosshair className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onToggleHidden(el.id);
                            }}
                            className={`p-0.5 transition-colors ${hidden ? "text-amber-500" : "text-slate-300 hover:text-slate-700"}`}
                            title={hidden ? "mostrar" : "ocultar"}
                            aria-label={`${hidden ? "mostrar" : "ocultar"} ${el.id}`}
                          >
                            {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
