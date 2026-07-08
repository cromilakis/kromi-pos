import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { emitirNotaCredito, buscarVentaPorFolio, type SaleWithLines } from "@/data/sales";
import type { ProductRow } from "@/data/stock";
import { businessToNegocio, type BusinessRow } from "@/data/business";
import { fmtCLP } from "@/lib/money";
import { printCreditNote } from "@/lib/print";
import { getPrinterName } from "@/lib/printerConfig";
import type { PayMethod } from "./PayDialog";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

interface NcLine {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  maxQty: number | null; // límite (líneas "por boleta"); null = manual, sin límite
  restock: boolean;
}

interface CreditNoteDialogProps {
  open: boolean;
  branchId?: string;
  sessionId?: string | null;
  products: ProductRow[];
  business?: BusinessRow;
  onClose: () => void;
  onEmitted: () => void;
}

/** Diálogo de emisión de nota de crédito: por boleta (busca folio) o manual. Clona `saveCreditNote` del prototipo. */
export function CreditNoteDialog({ open, branchId, sessionId, products, business, onClose, onEmitted }: CreditNoteDialogProps) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"boleta" | "manual">("boleta");
  const [folioInput, setFolioInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundSale, setFoundSale] = useState<SaleWithLines | null>(null);
  const [lines, setLines] = useState<NcLine[]>([]);
  const [method, setMethod] = useState<PayMethod>("efectivo");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("boleta");
      setFolioInput("");
      setFoundSale(null);
      setLines([]);
      setMethod("efectivo");
      setReason("");
    }
  }, [open]);

  if (!open) return null;

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const canSave = lines.some((l) => l.qty > 0);

  function switchMode(next: "boleta" | "manual") {
    setMode(next);
    setFoundSale(null);
    setLines([]);
  }

  async function handleBuscarFolio() {
    const folio = Number(folioInput);
    if (!branchId || !folio) return;
    setSearching(true);
    try {
      const sale = await buscarVentaPorFolio(branchId, folio);
      if (!sale) {
        toast.error(`No se encontró la boleta #${folio}.`);
        return;
      }
      setFoundSale(sale);
      setMethod(sale.method as PayMethod);
      setLines(
        sale.lines.map((l) => ({
          product_id: l.product_id ?? "",
          name: l.name_snapshot,
          price: l.price_snapshot,
          qty: l.qty,
          maxQty: l.qty,
          restock: true,
        })),
      );
    } catch (e) {
      toast.error(`No se pudo buscar la boleta: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSearching(false);
    }
  }

  function addManualLine() {
    setLines((ls) => [...ls, { product_id: "", name: "", price: 0, qty: 1, maxQty: null, restock: true }]);
  }
  function setManualProduct(idx: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, product_id: productId, name: p?.name ?? "", price: p?.price ?? 0 } : l)));
  }
  function setLineQty(idx: number, qty: number) {
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== idx) return l;
        const clamped = l.maxQty != null ? Math.min(Math.max(0, qty), l.maxQty) : Math.max(0, qty);
        return { ...l, qty: clamped };
      }),
    );
  }
  function toggleRestock(idx: number) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, restock: !l.restock } : l)));
  }
  function removeLine(idx: number) {
    setLines((ls) => ls.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!branchId) return;
    const usable = lines.filter((l) => l.product_id && l.qty > 0);
    if (!usable.length) {
      toast.error("Agregue al menos una línea con cantidad.");
      return;
    }
    setBusy(true);
    try {
      const nc = await emitirNotaCredito({
        p_branch: branchId,
        p_session: sessionId ?? null,
        p_sale: foundSale?.id ?? null,
        p_method: method,
        p_reason: reason.trim() || "Sin motivo",
        p_lines: usable.map((l) => ({ product_id: l.product_id, qty: l.qty, restock: l.restock })),
      });
      toast.success(`Nota de crédito #${nc.folio} emitida.`);
      onEmitted();
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      try {
        const createdAt = new Date(nc.created_at);
        await printCreditNote({
          negocio: businessToNegocio(business, getPrinterName()),
          folio: nc.folio,
          fecha: fmtDate(createdAt),
          hora: `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`,
          sale_folio: foundSale?.folio ?? null,
          metodo: nc.method,
          motivo: nc.reason ?? "Sin motivo",
          items: usable.map((l) => ({ nombre: l.name, qty: l.qty, precio: l.price })),
          neto: nc.neto,
          iva: nc.iva,
          total: nc.total,
        });
      } catch (e) {
        toast.error(`La nota de crédito se emitió, pero no se pudo imprimir: ${e instanceof Error ? e.message : e}`);
      }
      onClose();
    } catch (e) {
      toast.error(`No se pudo emitir la nota de crédito: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,42,27,.35)] p-6" onClick={onClose}>
      <div className="max-h-[90%] w-[580px] max-w-full overflow-auto rounded-[20px] bg-white p-[26px_28px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <div className="flex-1 text-[19px] font-black text-[#0F2A1B]">
            {foundSale ? `Nota de crédito · boleta #${String(foundSale.folio).padStart(4, "0")}` : "Nota de crédito manual"}
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-[9px] bg-[#F0F2F7] text-base font-bold text-[#5a6b7e]">
            ×
          </button>
        </div>

        <div className="mb-4 inline-flex gap-1 rounded-full bg-[#F0F2F7] p-1">
          <button
            onClick={() => switchMode("boleta")}
            className="rounded-full px-4 py-1.5 text-[13.5px] font-bold"
            style={mode === "boleta" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}
          >
            Por boleta
          </button>
          <button
            onClick={() => switchMode("manual")}
            className="rounded-full px-4 py-1.5 text-[13.5px] font-bold"
            style={mode === "manual" ? { background: "var(--brand)", color: "#fff" } : { color: "#5a6b7e" }}
          >
            Manual
          </button>
        </div>

        {mode === "boleta" && !foundSale && (
          <div className="mb-4 flex gap-2.5">
            <input
              value={folioInput}
              onChange={(e) => setFolioInput(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="N° de boleta"
              className="flex-1 rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none"
            />
            <button
              onClick={handleBuscarFolio}
              disabled={searching || !folioInput}
              className="rounded-[11px] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: "var(--brand)" }}
            >
              {searching ? "Buscando…" : "Buscar"}
            </button>
          </div>
        )}

        {(mode === "manual" || foundSale) && (
          <>
            <div className="mb-3.5 flex flex-col gap-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2.5 rounded-xl border border-[#E1E5EE] px-3 py-2.5">
                  {mode === "manual" ? (
                    <select
                      value={l.product_id}
                      onChange={(e) => setManualProduct(idx, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-[#E1E5EE] bg-[#F8FAFC] px-2.5 py-2 text-[13.5px] font-bold text-[#0F2A1B] outline-none"
                    >
                      <option value="">Seleccione un producto…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-[#0F2A1B]">{l.name}</div>
                      <div className="text-xs text-[#7C95A8]">
                        {fmtCLP(l.price)} c/u · {fmtCLP(l.price * l.qty)}
                      </div>
                    </div>
                  )}
                  <input
                    value={l.qty}
                    onChange={(e) => setLineQty(idx, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
                    inputMode="numeric"
                    className="w-14 rounded-lg border border-[#E1E5EE] px-2 py-2 text-center text-sm font-bold text-[#0F2A1B] outline-none"
                  />
                  <button
                    onClick={() => toggleRestock(idx)}
                    title="Reponer stock"
                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[#5a6b7e]"
                  >
                    <span
                      className="flex size-4 items-center justify-center rounded border"
                      style={l.restock ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" } : { borderColor: "#cdd5e3" }}
                    >
                      {l.restock ? "✓" : ""}
                    </span>
                    Stock
                  </button>
                  {mode === "manual" && (
                    <button onClick={() => removeLine(idx)} className="text-sm text-[#cdd5e3]">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {mode === "manual" && (
                <button onClick={addManualLine} className="self-start text-[13px] font-bold" style={{ color: "var(--brand)" }}>
                  + Agregar línea
                </button>
              )}
            </div>

            <div className="mb-3 flex gap-2.5">
              <div className="flex-1">
                <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Medio de devolución</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PayMethod)}
                  className="w-full rounded-[11px] border border-[#E1E5EE] bg-[#F8FAFC] px-3 py-2.5 text-sm font-bold text-[#0F2A1B] outline-none"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta (reverso)</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Total a devolver</label>
                <div className="rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-base font-black text-[#c0392b]">{fmtCLP(total)}</div>
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-[12.5px] font-bold text-[#5a6b7e]">Motivo</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. producto defectuoso"
                className="w-full rounded-[11px] border border-[#E1E5EE] px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none"
              />
            </div>

            <div className="flex gap-2.5">
              <button onClick={onClose} disabled={busy} className="flex-none rounded-xl border border-[#E1E5EE] bg-white px-5 py-3 text-[15px] font-bold text-[#2A3A2E] disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={busy || !canSave}
                className="flex-1 rounded-xl py-3 text-[15px] font-bold text-white disabled:opacity-50"
                style={{ background: canSave ? "#c0392b" : "#e0a9a2" }}
              >
                {busy ? "Emitiendo…" : "Emitir nota de crédito"}
              </button>
            </div>
          </>
        )}

        {mode === "boleta" && !foundSale && (
          <div className="flex justify-end">
            <button onClick={onClose} className="rounded-xl border border-[#E1E5EE] bg-white px-5 py-3 text-[15px] font-bold text-[#2A3A2E]">
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
