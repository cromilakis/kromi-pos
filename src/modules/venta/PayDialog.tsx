import { useEffect, useState } from "react";
import { fmtCLP } from "@/lib/money";

export type PayMethod = "efectivo" | "tarjeta";

interface PayDialogProps {
  open: boolean;
  total: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (method: PayMethod, recv: number) => void;
}

/** Diálogo de cobro: método, efectivo recibido y vuelto. Clona el popup de cobro del prototipo. */
export function PayDialog({ open, total, busy, onClose, onConfirm }: PayDialogProps) {
  const [method, setMethod] = useState<PayMethod>("tarjeta");
  const [cashStr, setCashStr] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("tarjeta");
      setCashStr("");
    }
  }, [open]);

  if (!open) return null;

  const recv = method === "efectivo" ? Number(cashStr) || 0 : total;
  const change = recv - total;
  const canConfirm = method === "tarjeta" || recv >= total;

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
          <div className="flex items-baseline justify-between rounded-2xl border border-[#E1E5EE] bg-[#F6F7FB] px-4 py-3">
            <span className="text-sm font-semibold text-[#556A7C]">Total a cobrar</span>
            <span className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(total)}</span>
          </div>
        </div>

        <div className="p-[22px_24px]">
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
                  <div className="text-[22px] font-black text-[#0F2A1B]">{fmtCLP(recv)}</div>
                </div>
                <div
                  className="flex-1 rounded-2xl px-3.5 py-2.5"
                  style={{ background: change < 0 ? "#FDECEC" : "var(--brand)", color: change < 0 ? "#9a2533" : "#fff" }}
                >
                  <div className="mb-0.5 text-[11px] font-semibold opacity-80">Vuelto</div>
                  <div className="text-[22px] font-black">{fmtCLP(Math.max(0, change))}</div>
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
              onClick={() => onConfirm(method, recv)}
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
