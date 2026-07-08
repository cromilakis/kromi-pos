import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  crearCotizacion,
  convertirCotizacion,
  useQuotes,
  isQuoteVigente,
  type QuoteRow,
} from "@/data/sales";
import { fmtCLP } from "@/lib/money";
import type { Totals } from "@/lib/money";
import { businessToNegocio, type BusinessRow } from "@/data/business";
import { printQuote, printReceipt } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import { PayDialog, type PayMethod } from "./PayDialog";
import type { CartLine } from "./Cart";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtIsoDate(iso: string): string {
  // "YYYY-MM-DD" -> "DD/MM/YYYY" (evita corrimiento de zona horaria de `new Date(iso)`).
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

interface QuotePanelProps {
  branchId?: string;
  businessId?: string;
  customerId?: string | null;
  sessionId?: string;
  business?: BusinessRow;
  cartLines: CartLine[];
  totals: Totals;
  onQuoteCreated: () => void;
}

/** Panel de cotizaciones: crear desde el carrito actual, listar vigentes, convertir a venta e imprimir. Clona `createQuote`/`convertQuote` del prototipo. */
export function QuotePanel({
  branchId,
  businessId,
  customerId,
  sessionId,
  business,
  cartLines,
  totals,
  onQuoteCreated,
}: QuotePanelProps) {
  const qc = useQueryClient();
  const { data: quotes, isLoading } = useQuotes(branchId);
  const [validDays, setValidDays] = useState(7);
  const [creating, setCreating] = useState(false);

  const [converting, setConverting] = useState<QuoteRow | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const negocio = useMemo(() => businessToNegocio(business, getPrinterName()), [business]);

  async function handleCrearCotizacion() {
    if (!branchId || !cartLines.length) return;
    setCreating(true);
    try {
      const quote = await crearCotizacion({
        branch_id: branchId,
        customer_id: customerId ?? null,
        valid_until: isoPlusDays(validDays),
        lines: cartLines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      });
      toast.success(`Cotización #${quote.folio} generada.`);
      onQuoteCreated();
      qc.invalidateQueries({ queryKey: ["quotes"] });
      try {
        await printQuote({
          negocio,
          folio: quote.folio,
          fecha: fmtDate(new Date()),
          valido_hasta: fmtIsoDate(quote.valid_until),
          cliente: "Sin cliente",
          items: cartLines.map((l) => ({ nombre: l.product.name, qty: l.qty, precio: l.product.price })),
          neto: quote.neto,
          iva: quote.iva,
          total: quote.total,
        });
      } catch (e) {
        toast.error(`La cotización se generó, pero no se pudo imprimir: ${e instanceof Error ? e.message : e}`);
      }
    } catch (e) {
      toast.error(`No se pudo generar la cotización: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCreating(false);
    }
  }

  async function handlePrintQuote(q: QuoteRow) {
    try {
      await printQuote({
        negocio,
        folio: q.folio,
        fecha: fmtIsoDate(q.created_at.slice(0, 10)),
        valido_hasta: fmtIsoDate(q.valid_until),
        cliente: q.customer_name ?? "Sin cliente",
        items: q.lines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
        neto: q.neto,
        iva: q.iva,
        total: q.total,
      });
    } catch (e) {
      toast.error(`No se pudo imprimir la cotización: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function handleConfirmConvert(method: PayMethod, recv: number) {
    if (!converting || !sessionId) return;
    setPayBusy(true);
    try {
      const sale = await convertirCotizacion(converting.id, sessionId, method, recv);
      const soldAt = new Date(sale.sold_at);
      toast.success(`Cotización convertida en venta #${sale.folio}.`);
      const quoteLines = converting.lines;
      setConverting(null);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["sales-today"] });
      qc.invalidateQueries({ queryKey: ["recent-sales"] });
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["customers", businessId] });
      try {
        await printReceipt({
          negocio,
          folio: sale.folio,
          fecha: fmtDate(soldAt),
          hora: `${pad2(soldAt.getHours())}:${pad2(soldAt.getMinutes())}`,
          items: quoteLines.map((l) => ({ nombre: l.name_snapshot, qty: l.qty, precio: l.price_snapshot })),
          neto: sale.neto,
          iva: sale.iva,
          total: sale.total,
          metodo: sale.method,
          open_drawer: sale.method === "efectivo",
        });
      } catch (e) {
        toast.error(`La venta se registró, pero no se pudo imprimir la boleta: ${e instanceof Error ? e.message : e}`);
      }
    } catch (e) {
      toast.error(`No se pudo convertir la cotización: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPayBusy(false);
    }
  }

  const rows = quotes ?? [];

  return (
    <div className="flex-1 overflow-auto px-[22px] pb-6 pt-[18px]">
      <div className="mb-5 rounded-2xl border border-[#E1E5EE] bg-white p-5">
        <div className="mb-3 text-[15px] font-black text-[#0F2A1B]">Nueva cotización</div>
        {cartLines.length === 0 ? (
          <div className="text-[13px] text-[#9aa8bd]">
            Agregue productos en la pestaña «Venta» para generar una cotización con esos ítems.
          </div>
        ) : (
          <>
            <div className="mb-3 text-[13px] text-[#7C95A8]">
              {totals.items} ítem(s) en el carrito actual · <span className="font-bold text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[12.5px] font-bold text-[#5a6b7e]">Válida por</label>
              <select
                value={validDays}
                onChange={(e) => setValidDays(Number(e.target.value))}
                className="rounded-lg border border-[#E1E5EE] bg-[#F8FAFC] px-2.5 py-1.5 text-[13px] font-bold text-[#0F2A1B]"
              >
                <option value={7}>7 días</option>
                <option value={15}>15 días</option>
                <option value={30}>30 días</option>
              </select>
              <button
                onClick={handleCrearCotizacion}
                disabled={creating}
                className="ml-auto rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: "var(--brand)" }}
              >
                {creating ? "Generando…" : "Generar cotización"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mb-3 text-[15px] font-black text-[#0F2A1B]">Cotizaciones vigentes</div>
      {isLoading && <div className="py-6 text-center text-[13px] text-[#9aa8bd]">Cargando cotizaciones…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="rounded-2xl border border-[#E1E5EE] bg-white py-8 text-center text-[13.5px] text-[#9aa8bd]">
          Aún no hay cotizaciones.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {rows.map((q) => {
          const vigente = isQuoteVigente(q.valid_until);
          const items = q.lines.reduce((s, l) => s + l.qty, 0);
          const badge = q.converted ? { label: "Convertida", bg: "#EAF0FF", fg: "#1d4ed8" } : vigente ? { label: "Vigente", bg: "#E6F7EE", fg: "#0a6e36" } : { label: "Vencida", bg: "#FCECEC", fg: "#c0392b" };
          const canConvert = !q.converted && vigente;
          return (
            <div key={q.id} className="flex items-center gap-4 rounded-2xl border border-[#E1E5EE] bg-white px-[18px] py-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-extrabold text-[#0F2A1B]">
                  COT-{q.folio} · {q.customer_name ?? "Sin cliente"}
                </div>
                <div className="mt-0.5 text-[12.5px] text-[#7C95A8]">
                  {fmtIsoDate(q.created_at.slice(0, 10))} · Vence {fmtIsoDate(q.valid_until)} · {items} ítems
                </div>
              </div>
              <span
                className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                style={{ background: badge.bg, color: badge.fg }}
              >
                {badge.label}
              </span>
              <div className="text-base font-black text-[#0F2A1B]">{fmtCLP(q.total)}</div>
              <button
                onClick={() => handlePrintQuote(q)}
                className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] font-bold text-[#5a6b7e]"
              >
                Imprimir
              </button>
              <button
                onClick={() => setConverting(q)}
                disabled={!canConvert}
                className="rounded-[10px] border px-3.5 py-2 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: "var(--brand)", color: "var(--brand)", background: "#fff" }}
              >
                Convertir
              </button>
            </div>
          );
        })}
      </div>

      <PayDialog
        open={!!converting}
        total={converting?.total ?? 0}
        busy={payBusy}
        onClose={() => setConverting(null)}
        onConfirm={handleConfirmConvert}
      />
    </div>
  );
}
