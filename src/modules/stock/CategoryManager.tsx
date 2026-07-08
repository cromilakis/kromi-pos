import { useState } from "react";
import { toast } from "sonner";
import type { CategoryRow } from "@/data/stock";
import { createCategory, deleteCategory, updateCategory } from "@/data/stock";
import { PALETTE } from "@/lib/categoryColors";

interface CategoryManagerProps {
  categories: CategoryRow[];
  productCountByCategory: Record<string, number>;
  businessId: string;
  onChanged: () => void;
}

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(DIACRITICS_RE, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cat"
  );
}

interface CatFormState {
  id: string | null;
  label: string;
  colorIdx: number;
}

export function CategoryManager({ categories, productCountByCategory, businessId, onChanged }: CategoryManagerProps) {
  const [form, setForm] = useState<CatFormState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setForm({ id: null, label: "", colorIdx: categories.length % PALETTE.length });
    setMsg(null);
  }
  function openEdit(c: CategoryRow) {
    const idx = PALETTE.findIndex((p) => p.dot === (c.dot ?? "").toLowerCase());
    setForm({ id: c.id, label: c.label, colorIdx: idx < 0 ? 0 : idx });
    setMsg(null);
  }

  async function save() {
    if (!form) return;
    const label = form.label.trim();
    if (!label) return;
    const pal = PALETTE[form.colorIdx] ?? PALETTE[0];
    setBusy(true);
    try {
      if (form.id == null) {
        const base = slugify(label);
        let key = base;
        let n = 2;
        while (categories.some((c) => c.key === key)) key = `${base}-${n++}`;
        await createCategory({ business_id: businessId, key, label, ...pal, sort: categories.length });
        toast.success("Categoría creada.");
      } else {
        await updateCategory(form.id, { label, ...pal });
        toast.success("Categoría actualizada.");
      }
      setForm(null);
      onChanged();
    } catch (e) {
      toast.error(`No se pudo guardar la categoría: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  function askDelete(c: CategoryRow) {
    const count = productCountByCategory[c.id] ?? 0;
    if (count > 0) {
      setMsg(`No se puede eliminar “${c.label}”: tiene ${count} producto(s). Reasigne o elimine esos productos primero.`);
      return;
    }
    setMsg(null);
    setConfirm(c);
  }

  async function confirmDelete() {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteCategory(confirm.id);
      toast.success("Categoría eliminada.");
      setConfirm(null);
      onChanged();
    } catch (e) {
      toast.error(`No se pudo eliminar la categoría: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-[11px] border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-sm text-[#0F2A1B] outline-none focus:border-[var(--brand)]";

  return (
    <div className="w-full">
      {msg && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-[#F5C2C2] bg-[#FDECEC] px-4 py-3 text-[13.5px] font-bold text-[#D02E2E]">
          {msg}
        </div>
      )}

      <div className="mb-3.5 flex items-center justify-end">
        {!form && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-[18px] py-2.5 text-sm font-bold text-[#0a6e36]"
          >
            + Nueva categoría
          </button>
        )}
      </div>

      {form && (
        <div className="mb-4 rounded-2xl border border-[#E1E5EE] bg-[#FAFBFD] p-4">
          <div className="mb-2.5 text-sm font-extrabold text-[#0F2A1B]">{form.id ? "Editar categoría" : "Nueva categoría"}</div>
          <input
            className={`${inputCls} mb-3`}
            value={form.label}
            onChange={(e) => setForm((f) => (f ? { ...f, label: e.target.value } : f))}
            placeholder="Nombre de la categoría"
            autoFocus
          />
          <div className="mb-3.5 flex flex-wrap gap-2">
            {PALETTE.map((p, idx) => (
              <button
                key={p.dot}
                onClick={() => setForm((f) => (f ? { ...f, colorIdx: idx } : f))}
                title="Elegir color"
                className="size-[26px] rounded-full"
                style={{
                  background: p.dot,
                  border: form.colorIdx === idx ? "2px solid #0F2A1B" : "2px solid transparent",
                  boxShadow: form.colorIdx === idx ? "0 0 0 2px #fff inset" : undefined,
                }}
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setForm(null)}
              disabled={busy}
              className="rounded-[11px] border border-[#E1E5EE] bg-white px-3.5 py-2.5 text-[13px] font-bold text-[#2A3A2E]"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-[11px] px-3.5 py-2.5 text-[13px] font-bold text-white disabled:opacity-70"
              style={{ background: "var(--brand)" }}
            >
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE] bg-white">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
              <th className="w-[64px] px-4 py-2.5">Color</th>
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5 text-right">Productos</th>
              <th className="px-4 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[13.5px] text-[#5E6E7E]">
                  Sin categorías todavía.
                </td>
              </tr>
            )}
            {categories.map((c) => (
              <tr key={c.id} className="border-t border-[#EEF1F6]">
                <td className="px-4 py-2.5">
                  <span
                    className="flex size-9 items-center justify-center rounded-[10px]"
                    style={{ background: c.tile ?? "#F0F2F7" }}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: c.dot ?? "#556A7C" }} />
                  </span>
                </td>
                <td className="px-4 py-2.5 font-bold text-[#0F2A1B]">{c.label}</td>
                <td className="px-4 py-2.5 text-right text-[#556A7C]">{productCountByCategory[c.id] ?? 0}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => openEdit(c)}
                      title="Editar categoría"
                      className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[#556A7C]"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => askDelete(c)}
                      title="Eliminar categoría"
                      className="flex size-[28px] items-center justify-center rounded-[9px] border border-[#F5C2C2] bg-white text-[#D02E2E]"
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setConfirm(null)}>
          <div className="w-[400px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-[15px] font-extrabold text-[#0F2A1B]">¿Eliminar la categoría “{confirm.label}”?</div>
            <div className="mb-4 text-[13px] text-[#556A7C]">Esta acción no se puede deshacer.</div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirm(null)}
                disabled={busy}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-70"
              >
                {busy ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
