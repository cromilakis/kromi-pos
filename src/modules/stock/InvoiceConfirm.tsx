import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useSupplierByRut, useSupplierProductMap, recepcionarFactura } from "@/data/purchases";
import { useCategories, useProductsWithStock } from "@/data/stock";
import { normalizeExtraction, checkLineTotal, sumLineTotals, totalsMatch, type Extraction, type ExtractedLine } from "@/lib/invoice";
import { fmtCLP } from "@/lib/money";

interface InvoiceConfirmProps {
  pdfPath: string;
  extraction: Extraction;
  onCancel: () => void;
  onDone: () => void;
}

interface LineState extends ExtractedLine {
  /**
   * Producto existente vinculado (por mapeo automático o elegido a mano).
   * Vacío ("") = no se mapea a ninguno existente → se creará un producto nuevo.
   */
  product_id: string;
  newName: string;
  newCategoryId: string;
}

/**
 * Revisión y confirmación de una factura ya extraída: proveedor (existente o nuevo),
 * mapeo de líneas a productos (automático, existente o nuevo) y verificación de montos.
 * Al confirmar, llama a la RPC `recepcionar_factura` que crea todo de forma atómica.
 */
export function InvoiceConfirm({ pdfPath, extraction: rawExtraction, onCancel, onDone }: InvoiceConfirmProps) {
  const { profile } = useAuth();
  const { branch } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();

  const extraction = useMemo(() => normalizeExtraction(rawExtraction), [rawExtraction]);

  const rut = extraction.proveedor.rut;
  const { data: existingSupplier, isLoading: loadingSupplier } = useSupplierByRut(rut || undefined);
  const supplierId = existingSupplier?.id;
  const { data: supplierMap } = useSupplierProductMap(supplierId);
  const { data: products } = useProductsWithStock(businessId, branchId);
  const { data: categories } = useCategories(businessId);

  const [newSupplier, setNewSupplier] = useState({
    razon_social: extraction.proveedor.razon_social,
    rut: extraction.proveedor.rut,
    giro: extraction.proveedor.giro,
    direccion: extraction.proveedor.direccion,
    email: "",
    phone: "",
  });

  const [lines, setLines] = useState<LineState[]>(() =>
    extraction.lineas.map((l) => ({ ...l, product_id: "", newName: l.description, newCategoryId: "" })),
  );

  // Auto-mapeo de cada línea a un producto interno existente, una sola vez, sin pisar
  // ediciones del usuario. Solo aplica cuando el proveedor ya existe (uno nuevo no tiene
  // productos previos). La asociación usa el código del proveedor de la línea, ya sea por
  // el mapeo guardado (supplier_product) o por el código interno con el formato con que se
  // guarda: {correlativo del proveedor}-{código del proveedor} (ej. 001-00T017).
  const appliedMapRef = useRef(false);
  useEffect(() => {
    if (appliedMapRef.current) return;
    if (loadingSupplier) return; // aún resolviendo si el proveedor existe
    if (existingSupplier && !supplierMap) return; // existe: esperar su mapa de códigos
    appliedMapRef.current = true;
    if (!existingSupplier) return; // proveedor nuevo: nada previo que mapear
    const seq3 = existingSupplier.seq != null ? String(existingSupplier.seq).padStart(3, "0") : null;
    const byInternalCode = new Map<string, string>();
    for (const p of products ?? []) if (p.internal_code) byInternalCode.set(p.internal_code, p.id);
    setLines((prev) => prev.map((l) => {
      if (!l.supplier_code) return l;
      const pid = supplierMap?.get(l.supplier_code)
        ?? (seq3 ? byInternalCode.get(`${seq3}-${l.supplier_code}`) : undefined);
      return pid ? { ...l, product_id: pid } : l;
    }));
  }, [loadingSupplier, existingSupplier, supplierMap, products]);

  const [submitting, setSubmitting] = useState(false);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const categoryById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.label])), [categories]);

  const computedTotal = useMemo(() => sumLineTotals(lines), [lines]);
  const amountsOk = totalsMatch(computedTotal, extraction.documento.neto);

  function updateLine(idx: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleConfirm() {
    if (!branchId) {
      toast.error("No hay sucursal seleccionada.");
      return;
    }

    let p_supplier: Record<string, unknown>;
    if (existingSupplier) {
      p_supplier = { id: existingSupplier.id };
    } else {
      if (!newSupplier.razon_social.trim() || !newSupplier.rut.trim()) {
        toast.error("Completa razón social y RUT del nuevo proveedor.");
        return;
      }
      p_supplier = {
        razon_social: newSupplier.razon_social.trim(),
        rut: newSupplier.rut.trim(),
        giro: newSupplier.giro.trim() || null,
        address: newSupplier.direccion.trim() || null,
        email: newSupplier.email.trim() || null,
        phone: newSupplier.phone.trim() || null,
      };
    }

    const p_lines: Record<string, unknown>[] = [];
    for (const l of lines) {
      const base = { supplier_code: l.supplier_code, description: l.description, qty: l.qty, unit_cost: l.unit_cost, line_total: l.line_total };
      if (l.product_id) {
        p_lines.push({ ...base, product_id: l.product_id });
      } else {
        // Sin producto existente seleccionado → se crea uno nuevo.
        if (!l.newName.trim()) {
          toast.error(`Falta el nombre del producto nuevo para la línea "${l.description || l.supplier_code}".`);
          return;
        }
        p_lines.push({ ...base, new_product: { name: l.newName.trim(), category_id: l.newCategoryId || null } });
      }
    }

    const p_doc = {
      doc_type: extraction.documento.tipo,
      folio: extraction.documento.folio,
      issued_at: extraction.documento.fecha,
      neto: extraction.documento.neto,
      iva: extraction.documento.iva,
      total: extraction.documento.total,
    };

    setSubmitting(true);
    try {
      await recepcionarFactura({ p_branch: branchId, p_supplier, p_doc, p_lines, p_pdf_path: pdfPath });
      toast.success("Factura recepcionada. Stock actualizado.");
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      qc.invalidateQueries({ queryKey: ["purchase-invoices"] });
      qc.invalidateQueries({ queryKey: ["supplier-product-map"] });
      onDone();
    } catch (e) {
      // El error de Supabase es un PostgrestError (objeto plano con code/message/details/hint),
      // no un Error: sin esto se mostraba "[object Object]".
      const err = (e ?? {}) as { code?: string; message?: string; details?: string; hint?: string };
      let msg: string;
      if (err.code === "23505") {
        msg = "Ya existe una factura con ese folio para este proveedor, o un producto con ese código interno (puede que ya se haya recepcionado, o que la factura repita un código de producto).";
      } else if (err.code === "23503") {
        msg = `Referencia inválida (sucursal, categoría o usuario no encontrado). ${err.details ?? ""}`.trim();
      } else {
        msg = err.message || (e instanceof Error ? e.message : String(e));
        if (err.code) msg = `[${err.code}] ${msg}`;
        if (err.details) msg += ` — ${err.details}`;
      }
      toast.error(`No se pudo recepcionar la factura: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[17px] font-black text-[#0F2A1B]">Confirmar recepción de factura</span>
          <span className="text-[13px] text-[#556A7C]">{extraction.documento.fecha || "sin fecha"}</span>
        </div>
        {extraction.documento.folio && (
          <span className="shrink-0 text-[15px] font-semibold" style={{ color: "var(--brand)" }}>
            #{extraction.documento.folio}
          </span>
        )}
      </div>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#5E6E7E]">Proveedor</span>
            {!loadingSupplier && !existingSupplier && (
              <span className="rounded-full bg-[#FEF6DD] px-2 py-0.5 text-[10.5px] font-black uppercase tracking-[.04em] text-[#8A6D12]">Nuevo</span>
            )}
          </div>
          {loadingSupplier ? (
            <div className="text-[13.5px] text-[#5E6E7E]">Buscando proveedor…</div>
          ) : existingSupplier ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#E1E5EE] bg-[#F7FAF8] px-4 py-2.5 text-[13px]">
              <span className="rounded-full bg-[#0F2A1B] px-2 py-0.5 text-[12px] font-black text-white">
                {existingSupplier.seq != null ? String(existingSupplier.seq).padStart(3, "0") : "—"}
              </span>
              <span className="font-black text-[#0F2A1B]">{existingSupplier.razon_social}</span>
              <span className="text-[#556A7C]">RUT {existingSupplier.rut || "—"}</span>
              {existingSupplier.giro && <span className="text-[#556A7C]">· {existingSupplier.giro}</span>}
              {existingSupplier.address && <span className="text-[#556A7C]">· {existingSupplier.address}</span>}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#E1E5EE] bg-white p-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">Razón social</span>
                  <input value={newSupplier.razon_social} onChange={(e) => setNewSupplier((s) => ({ ...s, razon_social: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">RUT</span>
                  <input value={newSupplier.rut} onChange={(e) => setNewSupplier((s) => ({ ...s, rut: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13.5px] font-bold text-[#0F2A1B] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">Giro</span>
                  <input value={newSupplier.giro} onChange={(e) => setNewSupplier((s) => ({ ...s, giro: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">Dirección</span>
                  <input value={newSupplier.direccion} onChange={(e) => setNewSupplier((s) => ({ ...s, direccion: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">Email (opcional)</span>
                  <input value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">Teléfono (opcional)</span>
                  <input value={newSupplier.phone} onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#5E6E7E]">Líneas ({lines.length})</div>
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                  <th className="px-3 py-2">Cód. prov</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Producto interno</th>
                  <th className="px-3 py-2">Nombre interno</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2 text-right">Costo unit</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const ok = checkLineTotal(l);
                  const linked = l.product_id ? productById.get(l.product_id) : undefined;
                  return (
                    <tr key={idx} className="border-t border-[#EEF1F6] align-top" style={{ background: ok ? undefined : "#FDECEC" }}>
                      <td className="px-3 py-1.5 font-semibold text-[#556A7C]">{l.supplier_code || "—"}</td>
                      <td className="px-3 py-1.5 font-semibold text-[#0F2A1B]">{l.description || "Sin descripción"}</td>
                      <td className="px-3 py-1.5">
                        <select value={l.product_id} onChange={(e) => updateLine(idx, { product_id: e.target.value })}
                          className="min-w-[180px] rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                          <option value="">Ninguno (Crear nuevo)</option>
                          {(products ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        {l.product_id ? (
                          <span className="text-[12.5px] font-semibold text-[#0F2A1B]">{linked?.name ?? "—"}</span>
                        ) : (
                          <input value={l.newName} onChange={(e) => updateLine(idx, { newName: e.target.value })}
                            placeholder="Nombre del producto nuevo" className="min-w-[150px] w-full rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none" />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {l.product_id ? (
                          <span className="text-[12.5px] text-[#5E6E7E]">{linked?.category_id ? (categoryById.get(linked.category_id) ?? "—") : "—"}</span>
                        ) : (
                          <select value={l.newCategoryId} onChange={(e) => updateLine(idx, { newCategoryId: e.target.value })}
                            className="rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                            <option value="">Sin categoría</option>
                            {(categories ?? []).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.unit_cost)}</td>
                      <td className="px-3 py-1.5 text-right font-bold text-[#0F2A1B]">{l.qty}</td>
                      <td className="px-3 py-1.5 text-right font-black" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {!amountsOk && (
          <div className="mb-4 rounded-xl bg-[#FBF1E0] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#9a6a1e]">
            La suma de las líneas ({fmtCLP(computedTotal)}) no coincide con el neto de la factura ({fmtCLP(extraction.documento.neto)}). Puedes
            confirmar igual y revisarlo después.
          </div>
        )}

        <div className="flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-70"
            style={{ background: "var(--brand)" }}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full" style={{ border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff" }} />
                Guardando…
              </span>
            ) : (
              "Confirmar recepción"
            )}
          </button>
        </div>
    </div>
  );
}
