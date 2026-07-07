import type { ProductRow } from "@/data/stock";
import { fmtCLP } from "@/lib/money";
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
  onPay: () => void;
}

/** Panel del carrito de la venta actual: líneas, totales (neto/IVA) y acciones. Clona el panel del prototipo. */
export function Cart({ lines, totals, onInc, onDec, onClear, onPay }: CartProps) {
  const hasCart = lines.length > 0;

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-[#E1E5EE] bg-white">
      <div className="border-b border-[#E1E5EE] p-5 pb-3">
        <div className="flex items-center justify-between">
          <div className="text-[18px] font-black text-[#0F2A1B]">Venta actual</div>
          {hasCart && (
            <span className="rounded-full bg-[#E7EFE8] px-2.5 py-0.5 text-xs font-bold text-[#0F2A1B]">
              {totals.items}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-1.5">
        {!hasCart && (
          <div className="flex h-full flex-col items-center justify-center px-5 py-10 text-center text-[#9aa8bd]">
            <div className="text-[15px] font-bold text-[#7C95A8]">Carrito vacío</div>
            <div className="text-[13px] text-[#9aa8bd]">Seleccione un producto para sumarlo a la venta.</div>
          </div>
        )}
        {lines.map(({ product, qty }) => (
          <div key={product.id} className="flex items-center gap-3 border-b border-[#F0F2F7] py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#0F2A1B]">{product.name}</div>
              <div className="text-xs text-[#7C95A8]">{fmtCLP(product.price)} c/u</div>
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
          </div>
        ))}
      </div>

      <div className="border-t border-[#E1E5EE] p-5">
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
        <div className="flex gap-2.5">
          <button
            onClick={onPay}
            disabled={!hasCart}
            className="flex-1 rounded-[14px] py-3.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-[#EEF1F6] disabled:text-[#9aa8bd]"
            style={hasCart ? { background: "var(--brand)" } : undefined}
          >
            Cobrar
          </button>
          <button
            onClick={onClear}
            disabled={!hasCart}
            title="Vaciar carrito"
            className="flex size-[54px] shrink-0 items-center justify-center rounded-[14px] border border-[#E1E5EE] bg-white text-[#7C95A8] disabled:opacity-40"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
