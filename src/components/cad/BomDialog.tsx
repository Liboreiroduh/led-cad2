"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2 } from "lucide-react";
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

export function BomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<BomRow[] | null>(null);
  const [total, setTotal] = useState(0);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-slate-800">Lista de Materiais (BOM)</DialogTitle>
          <DialogDescription>Derivada exclusivamente da geometria do ProjectDocument atual.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> calculando…
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-[50vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2">Descrição</th>
                    <th className="py-2 pr-2 text-right">Qtd</th>
                    <th className="py-2 pr-2 text-right">Comp. (m)</th>
                    <th className="py-2 text-right">Peso (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((r) => (
                    <tr key={r.item} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-500">{r.item}</td>
                      <td className="py-1.5 pr-2">{r.description}</td>
                      <td className="py-1.5 pr-2 text-right">{r.qty}</td>
                      <td className="py-1.5 pr-2 text-right">{r.total_length_m?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5 text-right">{r.total_weight_kg.toFixed(1)}</td>
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
              <div className="text-sm font-semibold text-slate-700">Peso total estimado: {total.toFixed(1)} kg</div>
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
