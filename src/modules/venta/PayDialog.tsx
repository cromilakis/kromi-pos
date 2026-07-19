import { useEffect, useState } from "react";
import { fmtCLP, resolveDiscount, roundCashCLP } from "@/lib/money";
import type { DiscountRow } from "@/data/discounts";

export type PayMethod = "efectivo" | "tarjeta";

export type DocType = "boleta" | "factura";

interface PayDialogProps {
  open: boolean;
  total: number;
  busy: boolean;
  discounts: DiscountRow[];
  customerPoints?: number;
  pointsRedeemRate?: number;
  canFactura?: boolean;
  onClose: () => void;
  onConfirm: (method: PayMethod, recv: number, discountId: string | null, pointsRedeem: number, docType: DocType) => void;
}

/** Diálogo de cobro: método, descuento predefinido, canje de puntos, efectivo recibido y vuelto. Clona el popup de cobro del prototipo. */
export function PayDialog({ open, total, busy, discounts, customerPoints = 0, pointsRedeemRate = 1, canFactura = false, onClose, onConfirm }: PayDialogProps) {
  const [method, setMethod] = useState<PayMethod>("tarjeta");
  const [cashStr, setCashStr] = useState("");
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [pointsRedeem, setPointsRedeem] = useState(0);
  const [docType, setDocType] = useState<DocType>("boleta");
  const [frozen, setFrozen] = useState<{ payTotal: number; recv: number; change: number } | null>(null);

  useEffect(() => {
    if (open) {
      setMethod("tarjeta");
      setCashStr("");
      setDiscountId(null);
      setPointsRedeem(0);
      setDocType("boleta");
      setFrozen(null);
    }
  }, [open]);

  useEffect(() => {
    if (!canFactura && docType === "factura") {
      setDocType("boleta");
    }
  }, [canFactura, docType]);

  if (!open) return null;

  const selected = pointsRedeem > 0 ? null : (discounts.find((d) => d.id === discountId) ?? null);
  const discAmount = selected ? resolveDiscount(total, "pct", selected.percent) : 0;
  const pointsDiscount = pointsRedeem > 0 ? Math.min(total, pointsRedeem * pointsRedeemRate) : 0;
  const effectiveTotal = total - discAmount - pointsDiscount;
  const maxPointsRedeem = Math.max(0, Math.min(customerPoints, Math.ceil(total / pointsRedeemRate)));

  const payTotal = method === "efectivo" ? roundCashCLP(effectiveTotal) : effectiveTotal;
  const recv = method === "efectivo" ? Number(cashStr) || 0 : effectiveTotal;
  const change = recv - payTotal;
  const canConfirm = method === "tarjeta" || recv >= payTotal;

  const showPayTotal = frozen?.payTotal ?? payTotal;
  const showRecv = frozen?.recv ?? recv;
  const showChange = frozen?.change ?? change;

  function pushCash(k: string) {
    setCashStr((v) => {
      if (k === "C") return "";
      if (k === "back") return v.slice(0, -1);
      return (v + k).replace(/^0+(?=\d)/, "").slice(0, 9);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-[440px] max-w-full rounded-[24px] bg-white">
        <div className="border-b border-[#E1E5EE] p-5">
          <div className="mb-3.5 flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#E6F7EE]">
              <span className="text-lg" style={{ color: "var(--brand)" }}>
                $
              </span>
            </div>
            <div className="text-[19px] font-black text-[#0F2A1B]">Cobro de la venta</div>
          </div>
          {discAmount > 0 && (
            <div className="mb-2 flex items-baseline justify-between px-1 text-[13px] font-bold text-[#D02E2E]">
              <span>Descuento ({selected?.name})</span>
              <span>-{fmtCLP(discAmount)}</span>
            </div>
          )}
          {pointsDiscount > 0 && (
            <div className="mb-2 flex items-baseline justify-between px-1 text-[13px] font-bold text-[#D02E2E]">
              <span>Canje de puntos ({pointsRedeem} pts)</span>
              <span>-{fmtCLP(pointsDiscount)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between rounded-2xl border border-[#E1E5EE] bg-[#F6F7FB] px-4 py-3">
            <span className="text-sm font-semibold text-[#556A7C]">Total a cobrar</span>
            <span className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(effectiveTotal)}</span>
          </div>
          {method === "efectivo" && showPayTotal !== effectiveTotal && (
            <div className="mt-2 flex items-baseline justify-between px-1 text-[13px] font-bold text-[#556A7C]">
              <span>Redondeo (efectivo) · Total a pagar</span>
              <span>{fmtCLP(showPayTotal)}</span>
            </div>
          )}
        </div>

        <div className="p-[22px_24px]">
          {discounts.length > 0 && (
            <div className="mb-[18px] px-6">
              <label className="mb-1 block text-[11px] font-semibold text-[#556A7C]">Descuento</label>
              <select
                value={discountId ?? ""}
                onChange={(e) => setDiscountId(e.target.value || null)}
                disabled={pointsRedeem > 0}
                className="w-full rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#2A3A2E] outline-none disabled:opacity-50"
              >
                <option value="">Sin descuento</option>
                {discounts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (−{d.percent}%)
                  </option>
                ))}
              </select>
            </div>
          )}
          {customerPoints > 0 && (
            <div className="mb-[18px] px-6">
              <label className="mb-1 block text-[11px] font-semibold text-[#556A7C]">
                Canjear puntos (disponibles: {customerPoints})
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={pointsRedeem === 0 ? "" : String(pointsRedeem)}
                  disabled={!!discountId}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    const n = digits === "" ? 0 : Math.min(maxPointsRedeem, Number(digits));
                    setPointsRedeem(n);
                  }}
                  placeholder="0"
                  className="w-full rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[13px] font-bold text-[#2A3A2E] outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setPointsRedeem(maxPointsRedeem)}
                  disabled={!!discountId || maxPointsRedeem <= 0}
                  className="shrink-0 rounded-xl border border-[#E1E5EE] bg-white px-3 py-2.5 text-[12px] font-bold text-[#2A3A2E] disabled:opacity-50"
                >
                  Usar todos
                </button>
              </div>
            </div>
          )}
          <div className="mb-[18px] px-6 pt-1">
            <label className="mb-1 block text-[11px] font-semibold text-[#556A7C]">Tipo de documento</label>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDocType("boleta")}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"
                style={
                  docType === "boleta"
                    ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                    : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
                }
              >
                Boleta
              </button>
              <button
                type="button"
                onClick={() => canFactura && setDocType("factura")}
                disabled={!canFactura}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                style={
                  docType === "factura"
                    ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                    : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
                }
              >
                Factura
              </button>
            </div>
            {!canFactura && (
              <div className="mt-1.5 text-[12px] font-medium text-[#556A7C]">
                Elige un cliente empresa para facturar
              </div>
            )}
          </div>

          <div className="mb-[18px] flex gap-2.5 px-6 pt-1">
            <button
              onClick={() => setMethod("efectivo")}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"
              style={
                method === "efectivo"
                  ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                  : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
              }
            >
              Efectivo
            </button>
            <button
              onClick={() => setMethod("tarjeta")}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"
              style={
                method === "tarjeta"
                  ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
                  : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
              }
            >
              Tarjeta
            </button>
          </div>

          {method === "efectivo" ? (
            <div className="px-6">
              <div className="mb-3.5 flex gap-2.5">
                <div className="flex-1 rounded-2xl border border-[#E1E5EE] bg-[#F6F7FB] px-3.5 py-2.5">
                  <div className="mb-0.5 text-[11px] font-semibold text-[#556A7C]">Recibido</div>
                  <div className="text-[22px] font-black text-[#0F2A1B]">{fmtCLP(showRecv)}</div>
                </div>
                <div
                  className="flex-1 rounded-2xl px-3.5 py-2.5"
                  style={{ background: showChange < 0 ? "#FDECEC" : "var(--brand)", color: showChange < 0 ? "#9a2533" : "#fff" }}
                >
                  <div className="mb-0.5 text-[11px] font-semibold opacity-80">Vuelto</div>
                  <div className="text-[22px] font-black">{fmtCLP(Math.max(0, showChange))}</div>
                </div>
              </div>
              <div className="mb-[18px] grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "back"].map((k) => (
                  <button
                    key={k}
                    onClick={() => pushCash(k)}
                    className="rounded-[11px] border border-[#E1E5EE] bg-white py-3 text-[15px] font-bold text-[#0F2A1B]"
                  >
                    {k === "back" ? "⌫" : k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-6 mb-[18px] rounded-2xl border border-dashed border-[#cdd5e3] bg-[#F6F7FB] px-5 py-7 text-center">
              <div className="text-[15px] font-bold text-[#0F2A1B]">Cobro en terminal externo</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-[#556A7C]">
                Realice el cobro en la terminal y, una vez finalizado, presione «Confirmar cobro».
              </div>
            </div>
          )}

          <div className="flex gap-2.5 px-6 pb-1">
            <button
              onClick={onClose}
              disabled={busy}
              className="w-[120px] rounded-2xl border border-[#E1E5EE] bg-white py-3.5 text-[15px] font-bold text-[#2A3A2E] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setFrozen({ payTotal, recv, change });
                onConfirm(method, recv, discountId, pointsRedeem, docType);
              }}
              disabled={busy || !canConfirm}
              className="flex-1 rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
              style={{ background: "var(--brand)" }}
            >
              {busy ? "Emitiendo boleta…" : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
