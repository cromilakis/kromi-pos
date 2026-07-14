import { useEffect, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useBusiness, updateBusiness } from "@/data/business";

interface FormState {
  lock_timeout_min: string;
}

const EMPTY: FormState = { lock_timeout_min: "" };

export function SecuritySettings() {
  const { profile } = useAuth();
  const businessId = profile?.business_id;
  const qc = useQueryClient();
  const { data: business, isLoading } = useBusiness(businessId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        lock_timeout_min: String(business.lock_timeout_min ?? ""),
      });
    }
  }, [business]);

  async function save() {
    if (!businessId) return;
    const lockTimeoutMin = Number(form.lock_timeout_min);
    if (!Number.isInteger(lockTimeoutMin) || lockTimeoutMin < 0) {
      toast.error("Los minutos de inactividad deben ser un entero mayor o igual a 0.");
      return;
    }
    setBusy(true);
    try {
      await updateBusiness(businessId, {
        lock_timeout_min: lockTimeoutMin,
      });
      toast.success("Configuración de seguridad actualizada.");
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
        <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Seguridad</h2>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando…</div>
      ) : (
        <div className="max-w-[640px] rounded-2xl border border-[#E1E5EE] bg-white p-6">
          <div className="grid grid-cols-1 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#5a6b7e]">Bloquear tras N minutos de inactividad (0 = nunca)</span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={form.lock_timeout_min}
                placeholder="0"
                onChange={(e) => setForm((s) => ({ ...s, lock_timeout_min: e.target.value.replace(/[^\d]/g, "") }))}
              />
              <span className="text-[11.5px] text-[#5E6E7E]">
                Al pasar este tiempo sin actividad, el POS se bloquea automáticamente y pide el PIN para continuar. Usa 0 para desactivar el bloqueo automático.
              </span>
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
