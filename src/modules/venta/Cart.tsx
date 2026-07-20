import { useState } from "react";
import type { ProductRow } from "@/data/stock";
import { fmtCLP, discountedPrice } from "@/lib/money";
import type { Totals } from "@/lib/money";

export interface CartLine {
  product: ProductRow;
  qty: number;
}

interface CartProps {
  lines: CartLine[];
  totals: Totals;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onClear: () => void;
  onHold: () => void;
  onPay: () => void;
  customerName: string | null;
  heldCount: number;
  onOpenHeld: () => void;
  onPickCustomer: () => void;
  onRemoveCustomer: () => void;
}

/** Panel del carrito de la venta actual: líneas, totales (neto/IVA) y acciones.
 *  En el encabezado: escoba (vaciar, con confirmación), guardar (retener) y abrir guardadas.
 *  Bajo el encabezado se muestra el cliente asignado a la venta actual (o el atajo para elegirlo).
 *  El descuento se configura a nivel de producto (Stock) y se muestra por línea. */
export function Cart({ lines, totals, onInc, onDec, onClear, onHold, onPay, customerName, heldCount, onOpenHeld, onPickCustomer, onRemoveCustomer }: CartProps) {
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
              onClick={onOpenHeld}
              title="Abrir ventas guardadas"
              className="relative flex size-[32px] items-center justify-center rounded-[10px] border border-[#E1E5EE] bg-white text-[15px] text-[#5a6b7e]"
            >
              📂
              {heldCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-black text-white">{heldCount}</span>
              )}
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

      <div className="flex items-center justify-between gap-2 border-b border-[#E1E5EE] px-5 py-2.5">
        {customerName ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#0F2A1B]">{customerName}</span>
            <button onClick={onRemoveCustomer} title="Quitar cliente" className="shrink-0 text-[#556A7C]">×</button>
          </>
        ) : (
          <button
            onClick={onPickCustomer}
            title="Registrar o elegir cliente"
            className="flex w-full cursor-pointer items-center justify-between gap-2 text-[13px] font-bold"
            style={{ color: "var(--brand)" }}
          >
            <span>Cliente no registrado</span>
            <span className="flex size-[22px] shrink-0 items-center justify-center rounded-lg bg-[#E6F7EE] text-[16px] leading-none">+</span>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-1.5">
        {!hasCart && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center text-[#5E6E7E]">
            <div className="text-[15px] font-bold text-[#556A7C]">Carrito vacío</div>
            <div className="text-[13px] text-[#5E6E7E]">Seleccione un producto para sumarlo a la venta.</div>
          </div>
        )}
        {lines.map(({ product, qty }) => (
          <div key={product.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold text-[#0F2A1B]">{product.name}</span>
                {(product.discount_pct ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full bg-[#E6F7EE] px-1.5 py-0.5 text-[9.5px] font-black text-[#0a6e36]">-{product.discount_pct}%</span>
                )}
              </div>
              <div className="text-xs text-[#556A7C]">
                {(product.discount_pct ?? 0) > 0 ? (
                  <><span className="line-through">{fmtCLP(product.price)}</span> <span className="font-bold text-[#0a6e36]">{fmtCLP(discountedPrice(product.price, product.discount_pct))}</span> c/u</>
                ) : (
                  <>{fmtCLP(product.price)} c/u</>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onDec(product.id)}
                className="flex size-[26px] items-center justify-center rounded-lg border border-[#E1E5EE] bg-white text-base text-[#556A7C]"
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
          </div>
        ))}
      </div>

      <div className="border-t border-[#E1E5EE] p-5">
        <div className="mb-1.5 flex justify-between text-[13px] text-[#556A7C]">
          <span>Subtotal</span>
          <span>{fmtCLP(totals.neto)}</span>
        </div>
        <div className="mb-2.5 flex justify-between text-[13px] text-[#556A7C]">
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
          className="w-full rounded-[14px] py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#5E6E7E]"
          style={hasCart ? { background: "var(--brand)" } : undefined}
        >
          Cobrar
        </button>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmClear(false); }}>
          <div className="w-[380px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Vaciar el carrito?</div>
            <div className="mb-4 text-[13px] text-[#556A7C]">Se quitarán todos los productos de la venta actual.</div>
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
