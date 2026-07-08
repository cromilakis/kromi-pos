import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useSupplierByRut, useSupplierProductMap, useNextSupplierSeq, recepcionarFactura } from "@/data/purchases";
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
  /** Producto existente vinculado (por mapeo automático o elegido a mano). Vacío si aún no se resuelve. */
  product_id: string;
  /** true si el usuario eligió crear un producto nuevo para esta línea. */
  newProduct: boolean;
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
  const { data: nextSeq } = useNextSupplierSeq(businessId);
  const supplierSeq = existingSupplier?.seq ?? nextSeq; // number | undefined

  const [newSupplier, setNewSupplier] = useState({
    razon_social: extraction.proveedor.razon_social,
    rut: extraction.proveedor.rut,
    giro: extraction.proveedor.giro,
    direccion: extraction.proveedor.direccion,
    email: "",
    phone: "",
  });

  const [lines, setLines] = useState<LineState[]>(() =>
    extraction.lineas.map((l) => ({ ...l, product_id: "", newProduct: false, newName: l.description, newCategoryId: "" })),
  );

  // Aplica el mapeo proveedor→código→producto una sola vez, cuando llega (no pisa ediciones del usuario).
  const appliedMapRef = useRef(false);
  useEffect(() => {
    if (appliedMapRef.current || !supplierMap) return;
    appliedMapRef.current = true;
    setLines((prev) => prev.map((l) => {
      const pid = supplierMap.get(l.supplier_code);
      return pid ? { ...l, product_id: pid } : l;
    }));
  }, [supplierMap]);

  const [submitting, setSubmitting] = useState(false);

  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

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
      } else if (l.newProduct) {
        if (!l.newName.trim()) {
          toast.error(`Falta el nombre del producto nuevo para la línea "${l.description || l.supplier_code}".`);
          return;
        }
        p_lines.push({ ...base, new_product: { name: l.newName.trim(), category_id: l.newCategoryId || null } });
      } else {
        toast.error(`Selecciona o crea un producto para la línea "${l.description || l.supplier_code}".`);
        return;
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
      toast.error(`No se pudo recepcionar la factura: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] rounded-[20px] border border-[#E1E5EE] bg-white p-6">
      <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Confirmar recepción de factura</div>
        <div className="mb-4 text-[13px] text-[#7C95A8]">
          Folio {extraction.documento.folio || "—"} · {extraction.documento.fecha || "sin fecha"}
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#9aa8bd]">Proveedor</div>
          {loadingSupplier ? (
            <div className="text-[13.5px] text-[#9aa8bd]">Buscando proveedor…</div>
          ) : existingSupplier ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[#E1E5EE] bg-[#F7FAF8] px-4 py-2.5 text-[13px]">
              <span className="rounded-full bg-[#0F2A1B] px-2 py-0.5 text-[12px] font-black text-white">
                {existingSupplier.seq != null ? String(existingSupplier.seq).padStart(3, "0") : "—"}
              </span>
              <span className="font-black text-[#0F2A1B]">{existingSupplier.razon_social}</span>
              <span className="text-[#7C95A8]">RUT {existingSupplier.rut || "—"}</span>
              {existingSupplier.giro && <span className="text-[#7C95A8]">· {existingSupplier.giro}</span>}
              {existingSupplier.address && <span className="text-[#7C95A8]">· {existingSupplier.address}</span>}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#E1E5EE] bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-[#FEF6DD] px-2 py-0.5 text-[11px] font-black uppercase tracking-[.04em] text-[#8A6D12]">
                  Nuevo proveedor
                </span>
                <span className="text-[12.5px] text-[#9aa8bd]">
                  se creará con ID {supplierSeq != null ? String(supplierSeq).padStart(3, "0") : "…"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">Razón social</span>
                  <input value={newSupplier.razon_social} onChange={(e) => setNewSupplier((s) => ({ ...s, razon_social: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">RUT</span>
                  <input value={newSupplier.rut} onChange={(e) => setNewSupplier((s) => ({ ...s, rut: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13.5px] font-bold text-[#0F2A1B] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">Giro</span>
                  <input value={newSupplier.giro} onChange={(e) => setNewSupplier((s) => ({ ...s, giro: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">Dirección</span>
                  <input value={newSupplier.direccion} onChange={(e) => setNewSupplier((s) => ({ ...s, direccion: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">Email (opcional)</span>
                  <input value={newSupplier.email} onChange={(e) => setNewSupplier((s) => ({ ...s, email: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">Teléfono (opcional)</span>
                  <input value={newSupplier.phone} onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))}
                    className="rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]" />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#9aa8bd]">Líneas ({lines.length})</div>
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
                  <th className="px-3 py-2 text-right">Cant</th>
                  <th className="px-3 py-2">Cód. prov</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2 text-right">Costo unit</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Producto interno</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const ok = checkLineTotal(l);
                  const linked = l.product_id ? productById.get(l.product_id) : undefined;
                  return (
                    <tr key={idx} className="border-t border-[#EEF1F6]" style={{ background: ok ? undefined : "#FDECEC" }}>
                      <td className="px-3 py-1.5 text-right font-bold text-[#0F2A1B]">{l.qty}</td>
                      <td className="px-3 py-1.5 font-semibold text-[#7C95A8]">{l.supplier_code || "—"}</td>
                      <td className="px-3 py-1.5 font-semibold text-[#0F2A1B]">{l.description || "Sin descripción"}</td>
                      <td className="px-3 py-1.5 text-right" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.unit_cost)}</td>
                      <td className="px-3 py-1.5 text-right font-black" style={{ color: ok ? "#0F2A1B" : "#9a2533" }}>{fmtCLP(l.line_total)}</td>
                      <td className="px-3 py-1.5">
                        {l.product_id ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#E7EFE8] px-2 py-0.5 text-[12px] font-bold text-[#0F2A1B]">
                              {linked?.internal_code ? `${linked.internal_code} · ` : "→ "}{linked?.name ?? "Producto vinculado"}
                            </span>
                            <button onClick={() => updateLine(idx, { product_id: "" })} className="text-[11px] font-bold text-[#7C95A8] underline">Cambiar</button>
                          </div>
                        ) : l.newProduct ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-[#EEF1F6] px-1.5 py-0.5 text-[11px] font-bold text-[#7C95A8]">
                              {supplierSeq != null ? String(supplierSeq).padStart(3, "0") : "…"}-{l.supplier_code || (idx + 1)}
                            </span>
                            <input value={l.newName} onChange={(e) => updateLine(idx, { newName: e.target.value })}
                              placeholder="Nombre del producto" className="min-w-[150px] flex-1 rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none" />
                            <select value={l.newCategoryId} onChange={(e) => updateLine(idx, { newCategoryId: e.target.value })}
                              className="rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                              <option value="">Sin categoría</option>
                              {(categories ?? []).map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                            </select>
                            <button onClick={() => updateLine(idx, { newProduct: false })} className="text-[11px] font-bold text-[#7C95A8] underline">Cancelar</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select value="" onChange={(e) => updateLine(idx, { product_id: e.target.value })}
                              className="min-w-[170px] rounded-[8px] border border-[#E1E5EE] px-2 py-1 text-[12.5px] outline-none">
                              <option value="" disabled>Elegir producto…</option>
                              {(products ?? []).map((p) => (
                                <option key={p.id} value={p.id}>{p.internal_code ? `${p.internal_code} · ${p.name}` : p.name}</option>
                              ))}
                            </select>
                            <button onClick={() => updateLine(idx, { newProduct: true })}
                              className="rounded-[8px] border border-[#A7E3C0] bg-[#E6F7EE] px-2 py-1 text-[12px] font-bold text-[#0a6e36]">+ Crear</button>
                          </div>
                        )}
                      </td>
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
            className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: "var(--brand)" }}
          >
            {submitting ? "Guardando…" : "Confirmar recepción"}
          </button>
        </div>
    </div>
  );
}
