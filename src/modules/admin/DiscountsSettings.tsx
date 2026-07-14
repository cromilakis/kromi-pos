import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { Plus, Trash2 } from "lucide-react";
import {
  useDiscounts,
  createDiscount,
  updateDiscount,
  softDeleteDiscount,
  isDiscountVigente,
  type DiscountRow,
} from "@/data/discounts";
import { errMsg, notifyError } from "@/lib/errors";

interface FormState {
  name: string;
  percent: string;
  active: boolean;
  valid_from: string;
  valid_until: string;
}

const EMPTY_FORM: FormState = { name: "", percent: "", active: true, valid_from: "", valid_until: "" };

function rowToForm(d: DiscountRow): FormState {
  return {
    name: d.name,
    percent: String(d.percent),
    active: d.active,
    valid_from: d.valid_from ?? "",
    valid_until: d.valid_until ?? "",
  };
}

function fmtIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function DiscountsSettings() {
  const { profile } = useAuth();
  const businessId = profile?.business_id;
  const qc = useQueryClient();
  const { data: discounts, isLoading } = useDiscounts(businessId);

  const [editing, setEditing] = useState<DiscountRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = discounts ?? [];

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(d: DiscountRow) {
    setEditing(d);
    setForm(rowToForm(d));
    setShowForm(true);
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["discounts", businessId] });
    qc.invalidateQueries({ queryKey: ["active-discounts", businessId] });
  }

  async function handleSave() {
    if (!businessId) return;
    const name = form.name.trim();
    const percent = Number(form.percent);
    if (!name) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      toast.error("El porcentaje debe estar entre 1 y 100.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        name,
        percent,
        active: form.active,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
      };
      if (editing) {
        await updateDiscount(editing.id, input);
        toast.success("Descuento actualizado.");
      } else {
        await createDiscount({ business_id: businessId, ...input });
        toast.success("Descuento creado.");
      }
      invalidate();
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      notifyError("No se pudo guardar el descuento.", errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await softDeleteDiscount(id);
      toast.success("Descuento eliminado.");
      setConfirmDeleteId(null);
      invalidate();
    } catch (e) {
      notifyError("No se pudo eliminar el descuento.", errMsg(e));
    } finally {
      setDeleting(false);
    }
  }

  const inputCls =
    "w-full rounded-[11px] border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]";

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>Administración</div>
          <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Descuentos</h2>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          <Plus className="size-4" strokeWidth={2.2} /> Nuevo descuento
        </button>
      </div>

      {isLoading && <div className="py-6 text-center text-[13px] text-[#5E6E7E]">Cargando descuentos…</div>}

      {!isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#E1E5EE] bg-white py-12 text-center">
          <div className="text-[15px] font-bold text-[#556A7C]">Aún no hay descuentos.</div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {rows.map((d) => {
            const vigente = isDiscountVigente(d);
            const activeBadge = d.active
              ? { label: "Activo", bg: "#E6F7EE", fg: "#0a6e36" }
              : { label: "Inactivo", bg: "#F0F2F7", fg: "#5a6b7e" };
            const vigenciaBadge = vigente
              ? { label: "Vigente", bg: "#E6F7EE", fg: "#0a6e36" }
              : { label: "Fuera de vigencia", bg: "#FCECEC", fg: "#c0392b" };
            const rango =
              d.valid_from || d.valid_until
                ? `${d.valid_from ? fmtIsoDate(d.valid_from) : "Sin inicio"} — ${d.valid_until ? fmtIsoDate(d.valid_until) : "Sin fin"}`
                : "Sin límite de fechas";
            return (
              <div key={d.id} className="flex items-center gap-4 rounded-2xl border border-[#E1E5EE] bg-white px-[18px] py-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-extrabold text-[#0F2A1B]">{d.name} · {d.percent}%</div>
                  <div className="mt-0.5 text-[12.5px] text-[#556A7C]">{rango}</div>
                </div>
                <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: activeBadge.bg, color: activeBadge.fg }}>{activeBadge.label}</span>
                <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: vigenciaBadge.bg, color: vigenciaBadge.fg }}>{vigenciaBadge.label}</span>
                <button onClick={() => openEdit(d)} className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] font-bold text-[#5a6b7e]">Editar</button>
                <button
                  onClick={() => setConfirmDeleteId(d.id)}
                  title="Eliminar descuento"
                  className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#F5C2C2] bg-white text-[#D02E2E] hover:bg-[#FDECEC]"
                >
                  <Trash2 className="size-[15px]" strokeWidth={1.9} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeForm(); }}
        >
          <div className="w-[420px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-[15px] font-extrabold text-[#0F2A1B]">{editing ? "Editar descuento" : "Nuevo descuento"}</div>
            <div className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-bold text-[#5a6b7e]">Nombre</span>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Ej. Alianza Plan Café"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-bold text-[#5a6b7e]">Porcentaje (1-100)</span>
                <input
                  className={inputCls}
                  value={form.percent}
                  onChange={(e) => setForm((s) => ({ ...s, percent: e.target.value.replace(/[^\d]/g, "") }))}
                  inputMode="numeric"
                  placeholder="10"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-[#5a6b7e]">Vigente desde</span>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.valid_from}
                    onChange={(e) => setForm((s) => ({ ...s, valid_from: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-bold text-[#5a6b7e]">Vigente hasta</span>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.valid_until}
                    onChange={(e) => setForm((s) => ({ ...s, valid_until: e.target.value }))}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13px] font-bold text-[#556A7C]">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((s) => ({ ...s, active: e.target.checked }))}
                  className="size-4"
                />
                Activo
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={closeForm}
                disabled={saving}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDeleteId(null); }}
        >
          <div className="w-[400px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Eliminar este descuento?</div>
            <div className="mb-4 text-[13px] text-[#556A7C]">Esta acción no se puede deshacer.</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {deleting ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
