import { useEffect, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import type { CategoryRow, ProductRow, SupplierRow } from "@/data/stock";
import { createProduct, updateProduct, upsertInventory } from "@/data/stock";
import { ImageUploader } from "@/components/ImageUploader";
import { uploadProductImage } from "@/lib/image";

interface ProductFormProps {
  open: boolean;
  onClose: () => void;
  product: ProductRow | null;
  categories: CategoryRow[];
  suppliers: SupplierRow[];
  businessId: string;
  branchId: string;
  onSaved: () => void;
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
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#556A7C", marginBottom: 6 };

export function ProductForm({ open, onClose, product, categories, suppliers, businessId, branchId, onSaved }: ProductFormProps) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("");
  const [critical, setCritical] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  const [imgUrl, setImgUrl] = useState("");
  const [barcode, setBarcode] = useState("");
  const [discountPct, setDiscountPct] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setCategoryId(product.category_id ?? "");
      setPrice(String(product.price));
      setStock(String(product.stock));
      setMinStock(product.min_stock ? String(product.min_stock) : "");
      setCritical(product.critical);
      setSupplierId(product.supplier_id ?? "");
      setImgUrl(product.img_url ?? "");
      setBarcode(product.barcode ?? "");
      setDiscountPct(product.discount_pct ? String(product.discount_pct) : "");
    } else {
      setName("");
      setCategoryId(categories[0]?.id ?? "");
      setPrice("");
      setStock("");
      setMinStock("");
      setCritical(false);
      setSupplierId("");
      setImgUrl("");
      setBarcode("");
      setDiscountPct("");
    }
  }, [open, product, categories]);

  if (!open) return null;

  const onlyDigits = (v: string) => v.replace(/[^\d]/g, "");

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("El nombre del producto es obligatorio.");
      return;
    }
    const priceNum = parseInt(price || "0", 10) || 0;
    const stockNum = parseInt(stock || "0", 10) || 0;
    const minStockNum = parseInt(minStock || "0", 10) || 0;
    const discountNum = Math.min(100, Math.max(0, parseInt(discountPct || "0", 10) || 0));
    setBusy(true);
    try {
      if (!product) {
        const created = await createProduct({
          business_id: businessId,
          name: trimmed,
          category_id: categoryId || null,
          price: priceNum,
          min_stock: minStockNum,
          critical,
          img_url: imgUrl.trim() || null,
          supplier_id: supplierId || null,
          barcode: barcode.trim() || null,
          discount_pct: discountNum,
        });
        await upsertInventory(created.id, branchId, stockNum);
        toast.success("Producto creado.");
      } else {
        await updateProduct(product.id, {
          name: trimmed,
          category_id: categoryId || null,
          price: priceNum,
          min_stock: minStockNum,
          critical,
          img_url: imgUrl.trim() || null,
          supplier_id: supplierId || null,
          barcode: barcode.trim() || null,
          discount_pct: discountNum,
        });
        await upsertInventory(product.id, branchId, stockNum);
        toast.success("Producto actualizado.");
      }
      onSaved();
      onClose();
    } catch (e) {
      notifyError(`No se pudo guardar el producto.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,64,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: 620, maxWidth: "100%", background: "#fff", borderRadius: 22, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #E1E5EE", display: "flex", alignItems: "center", gap: 15 }}>
          <div style={{ fontWeight: 900, fontSize: 19, color: "#0F2A1B", flex: 1 }}>{product ? "Editar producto" : "Agregar producto"}</div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, border: 0, background: "#F6F7FB", borderRadius: 9, color: "#556A7C", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Nombre del producto</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Monstera Deliciosa" />
          </div>
          <div>
            <label style={labelStyle}>Categoría</label>
            <select style={inputStyle} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Proveedor (opcional)</label>
            <select style={inputStyle} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.razon_social}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Precio (CLP)</label>
            <input style={inputStyle} value={price} onChange={(e) => setPrice(onlyDigits(e.target.value))} inputMode="numeric" placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>Stock (unidades)</label>
            <input style={inputStyle} value={stock} onChange={(e) => setStock(onlyDigits(e.target.value))} inputMode="numeric" placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>Stock mínimo (opcional)</label>
            <input style={inputStyle} value={minStock} onChange={(e) => setMinStock(onlyDigits(e.target.value))} inputMode="numeric" placeholder="Sin alerta" />
          </div>
          <div>
            <label style={labelStyle}>Descuento (%)</label>
            <input style={inputStyle} value={discountPct} onChange={(e) => setDiscountPct(onlyDigits(e.target.value).slice(0, 3))} inputMode="numeric" placeholder="0" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Código de barras (opcional)</label>
            <input style={inputStyle} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Escanea o escribe el código" />
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#556A7C", lineHeight: 1.4, marginTop: -6 }}>
            <b style={{ color: "#9A6F12", fontWeight: 700 }}>Stock mínimo</b>: si el stock baja de ese número se marca como stock bajo (vacío = sin alerta). <b style={{ color: "#0a6e36", fontWeight: 700 }}>Descuento</b> mayor a 0 vende el producto con ese % y lo marca <b style={{ color: "#0a6e36", fontWeight: 700 }}>CON DESCUENTO</b>.
          </div>
          <div
            onClick={() => setCritical((c) => !c)}
            style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", border: "1px solid #E1E5EE", borderRadius: 12, padding: "11px 14px", gridColumn: "1 / -1" }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                border: critical ? "0" : "1px solid #cdd5e3",
                background: critical ? "var(--brand)" : "#fff",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                flex: "none",
              }}
            >
              {critical ? "✓" : ""}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0F2A1B" }}>Producto crítico (esencial)</div>
              <div style={{ fontSize: 12, color: "#556A7C" }}>Aparece marcado con ★ y prioriza la reposición cuando esté bajo el mínimo.</div>
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Imagen del producto (opcional)</label>
            <ImageUploader
              value={imgUrl || null}
              onChange={(url) => setImgUrl(url ?? "")}
              onUpload={(blob) => uploadProductImage(businessId, blob)}
              maxSize={200}
              label="producto"
            />
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #E1E5EE", background: "#FAFBFD", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ minWidth: 110, border: "1px solid #E1E5EE", background: "#fff", color: "#2A3A2E", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={busy}
            style={{ minWidth: 130, border: 0, background: "var(--brand)", color: "#fff", borderRadius: 11, padding: "11px 18px", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
