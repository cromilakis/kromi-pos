import { useState } from "react";
import { toast } from "sonner";
import type { CategoryRow } from "@/data/stock";
import { createCategory, deleteCategory, updateCategory } from "@/data/stock";

interface CategoryManagerProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryRow[];
  productCountByCategory: Record<string, number>;
  businessId: string;
  onChanged: () => void;
}

const PALETTE = [
  { dot: "#22C463", tile: "#E6F7EE", pill_bg: "#D3F4E0", pill_fg: "#0a6e36" },
  { dot: "#DD5771", tile: "#FCEFF2", pill_bg: "#FCE4E9", pill_fg: "#A4264A" },
  { dot: "#5a8f3c", tile: "#EAF0E6", pill_bg: "#E2EDD8", pill_fg: "#3f6b1e" },
  { dot: "#DEA35D", tile: "#FBF1E0", pill_bg: "#F6E5C5", pill_fg: "#7a5a20" },
  { dot: "#8a7a4a", tile: "#EFEAE0", pill_bg: "#EAE0CC", pill_fg: "#6b5a30" },
  { dot: "#7764E0", tile: "#EEEBFB", pill_bg: "#E0DAF9", pill_fg: "#4632a8" },
  { dot: "#C2693C", tile: "#F7EBE3", pill_bg: "#F0D9CA", pill_fg: "#8A4423" },
  { dot: "#9C4F86", tile: "#F3E9F0", pill_bg: "#EBD7E5", pill_fg: "#6E2F5C" },
];

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

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #E1E5EE",
  borderRadius: 11,
  padding: "11px 14px",
  fontFamily: "inherit",
  fontSize: 14,
  color: "#0F2A1B",
  outline: "none",
  boxSizing: "border-box",
};

interface CatFormState {
  id: string | null;
  label: string;
  colorIdx: number;
}

export function CategoryManager({ open, onClose, categories, productCountByCategory, businessId, onChanged }: CategoryManagerProps) {
  const [form, setForm] = useState<CatFormState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function openAdd() {
    setForm({ id: null, label: "", colorIdx: categories.length % PALETTE.length });
    setMsg(null);
  }
  function openEdit(c: CategoryRow) {
    const idx = PALETTE.findIndex((p) => p.dot === c.dot);
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
        let base = slugify(label);
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
      setMsg(`No se puede eliminar "${c.label}": tiene ${count} producto(s). Reasigne o elimine esos productos primero.`);
      return;
    }
    setMsg(null);
    setConfirmId(c.id);
  }

  async function confirmDelete() {
    if (!confirmId) return;
    setBusy(true);
    try {
      await deleteCategory(confirmId);
      toast.success("Categoría eliminada.");
      setConfirmId(null);
      onChanged();
    } catch (e) {
      toast.error(`No se pudo eliminar la categoría: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }} onClick={onClose}>
      <div
        style={{ width: 560, maxWidth: "100%", maxHeight: "85vh", background: "#fff", borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,64,.35)", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #E1E5EE", display: "flex", alignItems: "center", gap: 15 }}>
          <div style={{ fontWeight: 900, fontSize: 19, color: "#0F2A1B", flex: 1 }}>Categorías</div>
          <button
            onClick={openAdd}
            style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #A7E3C0", background: "#E6F7EE", color: "#0a6e36", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
          >
            + Nueva
          </button>
          <button onClick={onClose} style={{ width: 32, height: 32, border: 0, background: "#F6F7FB", borderRadius: 9, color: "#7C95A8", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "18px 24px", overflow: "auto" }}>
          {msg && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#FDECEC", color: "#D02E2E", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13.5, fontWeight: 700 }}>
              {msg}
            </div>
          )}

          {form && (
            <div style={{ border: "1px solid #E1E5EE", borderRadius: 14, padding: 16, marginBottom: 16, background: "#FAFBFD" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#0F2A1B", marginBottom: 10 }}>{form.id ? "Editar categoría" : "Nueva categoría"}</div>
              <input
                style={{ ...inputStyle, marginBottom: 12 }}
                value={form.label}
                onChange={(e) => setForm((f) => (f ? { ...f, label: e.target.value } : f))}
                placeholder="Nombre de la categoría"
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {PALETTE.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => setForm((f) => (f ? { ...f, colorIdx: idx } : f))}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: p.dot,
                      border: form.colorIdx === idx ? "2px solid #0F2A1B" : "2px solid transparent",
                      cursor: "pointer",
                    }}
                    title="Elegir color"
                  />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setForm(null)}
                  disabled={busy}
                  style={{ border: "1px solid #E1E5EE", background: "#fff", color: "#2A3A2E", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={save}
                  disabled={busy}
                  style={{ border: 0, background: "var(--brand)", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
                >
                  {busy ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          )}

          {confirmId && (
            <div style={{ border: "1px solid #F5C2C2", borderRadius: 14, padding: 16, marginBottom: 16, background: "#FDECEC" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#9a2533", marginBottom: 10 }}>¿Eliminar esta categoría?</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setConfirmId(null)}
                  style={{ border: "1px solid #E1E5EE", background: "#fff", color: "#2A3A2E", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={busy}
                  style={{ border: 0, background: "#D02E2E", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", cursor: busy ? "default" : "pointer" }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
            {categories.length === 0 && <div style={{ color: "#9aa8bd", fontSize: 13.5 }}>Sin categorías todavía.</div>}
            {categories.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #E1E5EE", borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: c.tile ?? "#F0F2F7", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.dot ?? "#7C95A8" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0F2A1B", lineHeight: 1.2 }}>{c.label}</div>
                  <div style={{ fontSize: 12, color: "#7C95A8", marginTop: 2 }}>{productCountByCategory[c.id] ?? 0} producto(s)</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => openEdit(c)}
                    title="Editar categoría"
                    style={{ width: 28, height: 28, border: "1px solid #E1E5EE", background: "#fff", color: "#7C95A8", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => askDelete(c)}
                    title="Eliminar categoría"
                    style={{ width: 28, height: 28, border: "1px solid #F5C2C2", background: "#fff", color: "#D02E2E", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
