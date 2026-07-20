import { useEffect, useRef, useState } from "react";
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
  onPickCustomer?: () => void;
  onClose: () => void;
  onConfirm: (method: PayMethod, recv: number, discountId: string | null, pointsRedeem: number, docType: DocType) => void;
}

/** Diálogo de cobro: método, descuento predefinido, canje de puntos, efectivo recibido y vuelto. Clona el popup de cobro del prototipo. */
export function PayDialog({ open, total, busy, discounts, customerPoints = 0, pointsRedeemRate = 1, canFactura = false, onPickCustomer, onClose, onConfirm }: PayDialogProps) {
  const [method, setMethod] = useState<PayMethod>("tarjeta");
  const [cashStr, setCashStr] = useState("");
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [pointsRedeem, setPointsRedeem] = useState(0);
  const [docType, setDocType] = useState<DocType>("boleta");
  const [frozen, setFrozen] = useState<{ payTotal: number; recv: number; change: number } | null>(null);
  // Acciones vigentes para el teclado físico (evita re-suscribir el listener en cada tecla).
  const actionsRef = useRef<{ method: PayMethod; confirm: () => void }>({ method: "tarjeta", confirm: () => {} });

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

  // Teclado físico mientras el popup está abierto: dígitos y Backspace alimentan el monto
  // recibido (solo en efectivo); Enter confirma el cobro. Los dígitos/Backspace se ignoran si
  // el foco está en un input/select (ej. campo de puntos) para no interferir; Enter confirma
  // igual y hace preventDefault para no activar además un botón enfocado.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        actionsRef.current.confirm();
        return;
      }
      // Solo se respetan los campos de texto reales (input/textarea); un <select> no escribe.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Backspace") {
        e.preventDefault(); // evita que el webview navegue "atrás" al presionar Backspace
        if (actionsRef.current.method === "efectivo") pushCash("back");
        return;
      }
      if (actionsRef.current.method === "efectivo" && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pushCash(e.key);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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

  const showPayTotal = frozen && busy ? frozen.payTotal : payTotal;
  const showRecv = frozen && busy ? frozen.recv : recv;
  const showChange = frozen && busy ? frozen.change : change;

  function pushCash(k: string) {
    setCashStr((v) => {
      if (k === "C") return "";
      if (k === "back") return v.slice(0, -1);
      return (v + k).replace(/^0+(?=\d)/, "").slice(0, 9);
    });
  }

  function doConfirm() {
    if (busy || !canConfirm) return;
    setFrozen({ payTotal, recv, change });
    onConfirm(method, recv, discountId, pointsRedeem, docType);
  }
  // El listener de teclado (registrado arriba) lee siempre la acción vigente vía este ref.
  actionsRef.current = { method, confirm: doConfirm };

  const methodBtn = (m: PayMethod, label: string) => (
    <button
      type="button"
      onClick={() => setMethod(m)}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"
      style={
        method === m
          ? { background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }
          : { background: "#fff", borderColor: "#E1E5EE", color: "#2A3A2E" }
      }
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-[740px] max-w-full flex-col overflow-y-auto rounded-[24px] bg-white">
        <div className="flex items-center gap-3 border-b border-[#E1E5EE] p-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#E6F7EE]">
            <span className="text-lg" style={{ color: "var(--brand)" }}>
              $
            </span>
          </div>
          <div className="text-[19px] font-black text-[#0F2A1B]">Cobro de la venta</div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          {/* Columna izquierda: configuración */}
          <div className="space-y-4">
            <div>
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
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-[#556A7C]">
                  Elige un cliente empresa para facturar
                  {onPickCustomer && (
                    <button
                      type="button"
                      onClick={onPickCustomer}
                      className="font-bold underline"
                      style={{ color: "var(--brand)" }}
                    >
                      Elegir/crear cliente
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[#556A7C]">Método de pago</label>
              <div className="flex gap-2.5">
                {methodBtn("efectivo", "Efectivo")}
                {methodBtn("tarjeta", "Tarjeta")}
              </div>
            </div>

            {discounts.length > 0 && (
              <div>
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
              <div>
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
          </div>

          {/* Columna derecha: pago */}
          <div className="space-y-3">
            {discAmount > 0 && (
              <div className="flex items-baseline justify-between px-1 text-[13px] font-bold text-[#D02E2E]">
                <span>Descuento ({selected?.name})</span>
                <span>-{fmtCLP(discAmount)}</span>
              </div>
            )}
            {pointsDiscount > 0 && (
              <div className="flex items-baseline justify-between px-1 text-[13px] font-bold text-[#D02E2E]">
                <span>Canje de puntos ({pointsRedeem} pts)</span>
                <span>-{fmtCLP(pointsDiscount)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between rounded-2xl border border-[#E1E5EE] bg-[#F6F7FB] px-4 py-3">
              <span className="text-sm font-semibold text-[#556A7C]">Total a cobrar</span>
              <span className="text-[28px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(effectiveTotal)}</span>
            </div>
            {method === "efectivo" && showPayTotal !== effectiveTotal && (
              <div className="flex items-baseline justify-between px-1 text-[13px] font-bold text-[#556A7C]">
                <span>Redondeo (efectivo) · Total a pagar</span>
                <span>{fmtCLP(showPayTotal)}</span>
              </div>
            )}

            {method === "efectivo" ? (
              <>
                <div className="flex gap-2.5">
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
                <div className="grid grid-cols-3 gap-2">
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
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#cdd5e3] bg-[#F6F7FB] px-5 py-7 text-center">
                <div className="text-[15px] font-bold text-[#0F2A1B]">Cobro en terminal externo</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-[#556A7C]">
                  Realice el cobro en la terminal y, una vez finalizado, presione «Confirmar cobro».
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2.5 border-t border-[#E1E5EE] p-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="w-[140px] rounded-2xl border border-[#E1E5EE] bg-white py-3.5 text-[15px] font-bold text-[#2A3A2E] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={doConfirm}
            disabled={busy || !canConfirm}
            className="flex-1 rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
            style={{ background: "var(--brand)" }}
          >
            {busy ? "Emitiendo boleta…" : "Confirmar cobro"}
          </button>
        </div>
      </div>
    </div>
  );
}
