import { useState } from "react";
import type { ProductRow } from "@/data/stock";
import { fmtCLP, resolveDiscount, discountedPrice } from "@/lib/money";
import type { Totals } from "@/lib/money";

export interface CartLine {
  product: ProductRow;
  qty: number;
  disc_kind?: "pct" | "amount" | null;
  disc_value?: number;
}

interface CartProps {
  lines: CartLine[];
  totals: Totals;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onClear: () => void;
  onHold: () => void;
  onPay: () => void;
  canDiscount: boolean;
  totalDisc: { kind: "pct" | "amount"; value: number } | null;
  onSetTotalDisc: (d: { kind: "pct" | "amount"; value: number } | null) => void;
  onSetLineDisc: (id: string, kind: "pct" | "amount" | null, value: number) => void;
}

/** Control compacto de descuento: tipo (— / % / $) + valor. */
function DiscountControl({ kind, value, onChange }: {
  kind: "pct" | "amount" | null;
  value: number;
  onChange: (k: "pct" | "amount" | null, v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={kind ?? ""}
        onChange={(e) => onChange((e.target.value || null) as "pct" | "amount" | null, value)}
        className="rounded-md border border-[#E1E5EE] bg-white px-1.5 py-1 text-xs font-bold text-[#5a6b7e]"
      >
        <option value="">—</option>
        <option value="pct">%</option>
        <option value="amount">$</option>
      </select>
      <input
        value={value || ""}
        onChange={(e) => onChange(kind, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
        inputMode="numeric"
        placeholder="0"
        disabled={!kind}
        className="w-16 rounded-md border border-[#E1E5EE] bg-white px-2 py-1 text-xs text-[#0F2A1B] outline-none disabled:opacity-50"
      />
    </span>
  );
}

/** Panel del carrito de la venta actual: líneas, totales (neto/IVA) y acciones.
 *  En el encabezado: escoba (vaciar, con confirmación) y diskette (guardar/retener). */
export function Cart({ lines, totals, onInc, onDec, onClear, onHold, onPay, canDiscount, totalDisc, onSetTotalDisc, onSetLineDisc }: CartProps) {
  const hasCart = lines.length > 0;
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-[#E1E5EE] bg-white">
      <div className="border-b border-[#E1E5EE] p-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-[18px] font-black text-[#0F2A1B]">Venta actual</div>
            {hasCart && (
              <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">
                {totals.items}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onHold}
              disabled={!hasCart}
              title="Guardar venta para retomarla después"
              className="flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e] disabled:opacity-40"
            >
              💾
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={!hasCart}
              title="Vaciar carrito"
              className="flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e] disabled:opacity-40"
            >
              🧹
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-1.5">
        {!hasCart && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center text-[#9aa8bd]">
            <div className="text-[15px] font-bold text-[#7C95A8]">Carrito vacío</div>
            <div className="text-[13px] text-[#9aa8bd]">Seleccione un producto para sumarlo a la venta.</div>
          </div>
        )}
        {lines.map(({ product, qty, disc_kind, disc_value }) => {
          const lineDisc = resolveDiscount(product.price * qty, disc_kind ?? null, disc_value ?? 0);
          return (
          <div key={product.id} className="flex flex-wrap items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold text-[#0F2A1B]">{product.name}</span>
                {(product.discount_pct ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full bg-[#E6F7EE] px-1.5 py-0.5 text-[9.5px] font-black uppercase text-[#0a6e36]">-{product.discount_pct}%</span>
                )}
              </div>
              <div className="text-xs text-[#7C95A8]">
                {(product.discount_pct ?? 0) > 0 ? (
                  <><span className="line-through">{fmtCLP(product.price)}</span> <span className="font-bold text-[#0a6e36]">{fmtCLP(discountedPrice(product.price, product.discount_pct))}</span> c/u</>
                ) : (
                  <>{fmtCLP(product.price)} c/u</>
                )}
                {lineDisc > 0 && <span className="ml-1.5 font-bold text-[#D02E2E]">-{fmtCLP(lineDisc)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onDec(product.id)}
                className="flex size-[26px] items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-base text-[#7C95A8]"
              >
                –
              </button>
              <span className="min-w-4 text-center text-sm font-bold text-[#0F2A1B]">{qty}</span>
              <button
                onClick={() => onInc(product.id)}
                disabled={qty >= product.stock}
                className="flex size-[26px] items-center justify-center rounded-lg bg-[#D3F4E0] text-base disabled:opacity-40"
                style={{ color: "var(--brand)" }}
              >
                +
              </button>
            </div>
            {canDiscount && (
              <div className="flex w-full items-center gap-2">
                <span className="text-[11px] font-semibold text-[#9aa8bd]">Desc.</span>
                <DiscountControl kind={disc_kind ?? null} value={disc_value ?? 0} onChange={(k, v) => onSetLineDisc(product.id, k, v)} />
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="border-t border-[#E1E5EE] p-5">
        {canDiscount && (
          <div className="mb-2 flex items-center justify-between gap-2 text-[13px] text-[#7C95A8]">
            <span className="inline-flex items-center gap-2">
              Descuento
              <DiscountControl kind={totalDisc?.kind ?? null} value={totalDisc?.value ?? 0} onChange={(k, v) => onSetTotalDisc(k ? { kind: k, value: v } : null)} />
            </span>
            <span className="font-bold text-[#D02E2E]">{totals.discount > 0 ? `-${fmtCLP(totals.discount)}` : ""}</span>
          </div>
        )}
        <div className="mb-1.5 flex justify-between text-[13px] text-[#7C95A8]">
          <span>Subtotal</span>
          <span>{fmtCLP(totals.neto)}</span>
        </div>
        <div className="mb-2.5 flex justify-between text-[13px] text-[#7C95A8]">
          <span>IVA 19%</span>
          <span>{fmtCLP(totals.iva)}</span>
        </div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <span className="text-lg font-black text-[#0F2A1B]">Total</span>
          <span className="text-[28px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(totals.total)}</span>
        </div>
        <button
          onClick={onPay}
          disabled={!hasCart}
          className="w-full rounded-[14px] py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#9aa8bd]"
          style={hasCart ? { background: "var(--brand)" } : undefined}
        >
          Cobrar
        </button>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setConfirmClear(false)}>
          <div className="w-[380px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Vaciar el carrito?</div>
            <div className="mb-4 text-[13px] text-[#7C95A8]">Se quitarán todos los productos de la venta actual.</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button
                onClick={() => { onClear(); setConfirmClear(false); }}
                className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white"
              >
                Vaciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
