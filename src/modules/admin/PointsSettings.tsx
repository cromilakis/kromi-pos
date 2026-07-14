import { useEffect, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useBusiness, updateBusiness } from "@/data/business";

interface FormState {
  points_clp_per_point: string;
  points_multiplier: string;
  points_redeem_clp_per_point: string;
}

const EMPTY: FormState = { points_clp_per_point: "", points_multiplier: "", points_redeem_clp_per_point: "" };

export function PointsSettings() {
  const { profile } = useAuth();
  const businessId = profile?.business_id;
  const qc = useQueryClient();
  const { data: business, isLoading } = useBusiness(businessId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        points_clp_per_point: String(business.points_clp_per_point ?? ""),
        points_multiplier: String(business.points_multiplier ?? ""),
        points_redeem_clp_per_point: String(business.points_redeem_clp_per_point ?? ""),
      });
    }
  }, [business]);

  async function save() {
    if (!businessId) return;
    const clpPerPoint = Number(form.points_clp_per_point);
    const multiplier = Number(form.points_multiplier);
    const redeemClpPerPoint = Number(form.points_redeem_clp_per_point);
    if (!Number.isInteger(clpPerPoint) || clpPerPoint < 1) {
      toast.error("La acumulación debe ser un entero mayor o igual a 1.");
      return;
    }
    if (!Number.isInteger(multiplier) || multiplier < 1) {
      toast.error("El multiplicador debe ser un entero mayor o igual a 1.");
      return;
    }
    if (!Number.isInteger(redeemClpPerPoint) || redeemClpPerPoint < 1) {
      toast.error("El valor de canje debe ser un entero mayor o igual a 1.");
      return;
    }
    setBusy(true);
    try {
      await updateBusiness(businessId, {
        points_clp_per_point: clpPerPoint,
        points_multiplier: multiplier,
        points_redeem_clp_per_point: redeemClpPerPoint,
      });
      toast.success("Configuración de puntos actualizada.");
      qc.invalidateQueries({ queryKey: ["business", businessId] });
    } catch (e) {
      notifyError("No se pudo guardar.", e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-[11px] border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]";

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Administración</div>
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Puntos</h2>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando…</div>
      ) : (
        <div className="max-w-[640px] rounded-2xl border border-[#E1E5EE] bg-white p-6">
          <div className="grid grid-cols-1 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Acumulación — cada $X = 1 punto</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={form.points_clp_per_point}
                placeholder="1000"
                onChange={(e) => setForm((s) => ({ ...s, points_clp_per_point: e.target.value.replace(/[^\d]/g, "") }))}
              />
              <span className="text-[11.5px] text-[#5E6E7E]">Por cada $X en compras, el cliente acumula 1 punto.</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Multiplicador de puntos (promociones)</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={form.points_multiplier}
                placeholder="1"
                onChange={(e) => setForm((s) => ({ ...s, points_multiplier: e.target.value.replace(/[^\d]/g, "") }))}
              />
              <span className="text-[11.5px] text-[#5E6E7E]">
                Multiplica los puntos acumulados en cada venta. Ej: súbelo a 2 para dar doble puntos el fin de semana.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Valor de canje — 1 punto = $Y de descuento</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={form.points_redeem_clp_per_point}
                placeholder="1"
                onChange={(e) => setForm((s) => ({ ...s, points_redeem_clp_per_point: e.target.value.replace(/[^\d]/g, "") }))}
              />
              <span className="text-[11.5px] text-[#5E6E7E]">Cada punto que el cliente canjea equivale a $Y de descuento en la venta.</span>
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-[12px] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-70"
              style={{ background: "var(--brand)" }}
            >
              {busy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
