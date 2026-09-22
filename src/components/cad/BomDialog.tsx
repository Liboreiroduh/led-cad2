"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2, Package, Weight, Layers3, TrendingUp } from "lucide-react";
import { api, ApiCallError } from "@/lib/cad/client-api";
import { toast } from "sonner";

interface BomRow {
  item: string;
  description: string;
  group: string;
  qty: number;
  total_length_m: number | null;
  total_weight_kg: number;
}

/** paleta sem azul/indigo — tons quentes e neutros consistentes com o app */
const GROUP_COLORS = ["#ea580c", "#16a34a", "#d97706", "#64748b", "#dc2626", "#7c3aed", "#0d9488", "#a16207", "#57534e", "#be185d"];

export function BomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<BomRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [elementCount, setElementCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const b = await api.bom();
        if (cancelled) return;
        setRows(b.rows);
        setTotal(b.total_weight_kg);
        setElementCount(b.element_count ?? 0);
      } catch (e) {
        toast.error((e as ApiCallError).payload?.message ?? (e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // -------- insights derivados das linhas do BOM --------
  const insights = useMemo(() => {
    if (!rows?.length) return null;
    const byGroup = new Map<string, number>();
    for (const r of rows) byGroup.set(r.group, (byGroup.get(r.group) ?? 0) + r.total_weight_kg);
    const groups = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);
    const heaviest = [...rows].sort((a, b) => b.total_weight_kg - a.total_weight_kg)[0];
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    return {
      groups: groups.map(([g, w], i) => ({ group: g, weight: w, pct: total > 0 ? (w / total) * 100 : 0, color: GROUP_COLORS[i % GROUP_COLORS.length] })),
      heaviest,
      totalQty,
    };
  }, [rows, total]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-slate-800 flex items-center gap-2">
            <span className="h-7 w-7 rounded-lg bg-orange-100 border border-orange-200 grid place-items-center shrink-0">
              <Package className="h-4 w-4 text-orange-600" />
            </span>
            Lista de Materiais (BOM)
          </DialogTitle>
          <DialogDescription>Derivada exclusivamente da geometria do ProjectDocument atual.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> calculando…
          </div>
        ) : (
          <>
            {/* ---- insights ---- */}
            {insights && insights.groups.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
                    <Layers3 className="h-3.5 w-3.5 text-orange-600" /> distribuição de peso por grupo
                  </span>
                  <span className="text-slate-400">
                    {rows!.length} itens · {insights.totalQty} peças{elementCount ? ` · ${elementCount} elementos` : ""}
                  </span>
                </div>
                {/* barra empilhada */}
                <div
                  className="flex h-3.5 w-full rounded-full overflow-hidden border border-slate-200 bg-white"
                  role="img"
                  aria-label="Distribuição de peso estimado por grupo"
                >
                  {insights.groups.map((g) => (
                    <div
                      key={g.group}
                      title={`${g.group} — ${g.weight.toFixed(1)} kg (${g.pct.toFixed(1)}%)`}
                      style={{ width: `${g.pct}%`, backgroundColor: g.color }}
                      className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                    />
                  ))}
                </div>
                {/* legenda dos 4 maiores + resto */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-600">
                  {insights.groups.slice(0, 4).map((g) => (
                    <span key={g.group} className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: g.color }} aria-hidden />
                      <span className="font-medium max-w-36 truncate">{g.group}</span>
                      <span className="text-slate-400">{g.pct.toFixed(0)}%</span>
                    </span>
                  ))}
                  {insights.groups.length > 4 && (
                    <span className="text-slate-400">+{insights.groups.length - 4} grupos</span>
                  )}
                </div>
                {/* item mais pesado */}
                {insights.heaviest && insights.heaviest.total_weight_kg > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600 pt-0.5">
                    <TrendingUp className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                    <span>
                      maior peso: <span className="font-semibold text-slate-700">{insights.heaviest.description}</span>{" "}
                      <span className="text-slate-400">({insights.heaviest.qty}× · {insights.heaviest.total_weight_kg.toFixed(1)} kg)</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            <ScrollArea className="max-h-[42vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-slate-500 border-b-2 border-slate-200">
                    <th className="py-2 pr-2 font-bold">Item</th>
                    <th className="py-2 pr-2 font-bold">Descrição</th>
                    <th className="py-2 pr-2 text-right font-bold">Qtd</th>
                    <th className="py-2 pr-2 text-right font-bold">Comp. (m)</th>
                    <th className="py-2 text-right font-bold">Peso (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((r, i) => (
                    <tr key={r.item} className={`border-b border-slate-100 ${i % 2 === 1 ? "bg-slate-50/60" : ""} hover:bg-orange-50/50 transition-colors`}>
                      <td className="py-1.5 pr-2 text-slate-400 font-mono text-[11px]">{r.item}</td>
                      <td className="py-1.5 pr-2">
                        {r.description}
                        <span className="block text-[10px] text-slate-400">{r.group}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{r.qty}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{r.total_length_m?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{r.total_weight_kg.toFixed(1)}</td>
                    </tr>
                  ))}
                  {!rows?.length && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400">
                        nenhum item derivável
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Weight className="h-4 w-4 text-orange-600" />
                Peso total estimado: <span className="tabular-nums">{total.toFixed(1)} kg</span>
                {total > 0 && <span className="text-[11px] font-normal text-slate-400">({(total / 1000).toFixed(3)} t)</span>}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.downloadBomCsv().catch((e: ApiCallError) => toast.error(e.message));
                }}
              >
                <Download className="h-4 w-4 mr-1" /> CSV
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
