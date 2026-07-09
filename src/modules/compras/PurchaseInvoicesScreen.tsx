import { useMemo, useState } from "react";
import { notifyError } from "@/lib/errors";
import { toast } from "sonner";
import { usePurchaseInvoices, invoiceDownloadUrl } from "@/data/purchases";
import { useSuppliers } from "@/data/stock";
import { filterInvoices, type InvoiceFilters } from "@/lib/invoiceFilters";
import { fmtCLP } from "@/lib/money";
import { fmtDateCL } from "@/lib/dates";
import { saveUrlAs } from "@/lib/fileSave";

interface Props {
  businessId: string | undefined;
}

/** El join `supplier:supplier_id(razon_social)` se tipa como arreglo; tomamos el primero. */
function supplierName(supplier: { razon_social: string }[] | { razon_social: string } | null | undefined): string {
  if (!supplier) return "—";
  const row = Array.isArray(supplier) ? supplier[0] : supplier;
  return row?.razon_social ?? "—";
}

const EMPTY_FILTERS: InvoiceFilters = { supplierId: "", from: "", to: "", min: "", max: "", text: "" };

/** Listado de facturas de compra con filtros (proveedor, fechas, monto, texto) y descarga del PDF. */
export function PurchaseInvoicesScreen({ businessId }: Props) {
  const { data: invoices, isLoading } = usePurchaseInvoices(businessId);
  const { data: suppliers } = useSuppliers(businessId);
  const [f, setF] = useState<InvoiceFilters>(EMPTY_FILTERS);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const mapped = (invoices ?? []).map((inv) => ({ ...inv, supplierName: supplierName(inv.supplier) }));
    return filterInvoices(mapped, f);
  }, [invoices, f]);

  const anyFilter = f.supplierId || f.from || f.to || f.min || f.max || f.text;

  async function handleDownload(id: string, pdfPath: string | null) {
    if (!pdfPath) {
      toast.error("Esta factura no tiene un PDF archivado.");
      return;
    }
    setDownloadingId(id);
    try {
      const url = await invoiceDownloadUrl(pdfPath);
      const suggested = pdfPath.split("/").pop() ?? "factura.pdf";
      const saved = await saveUrlAs(url, suggested);
      if (saved) toast.success("PDF guardado.");
    } catch (err) {
      notifyError(`No se pudo descargar el PDF.`, err instanceof Error ? err.message : err);
    } finally {
      setDownloadingId(null);
    }
  }

  const inputCls = "rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--brand)]";

  return (
    <div className="w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6">
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
        <input value={f.text} onChange={(e) => setF((s) => ({ ...s, text: e.target.value }))} placeholder="Buscar folio o proveedor…" className={`${inputCls} lg:col-span-2`} />
        <select value={f.supplierId} onChange={(e) => setF((s) => ({ ...s, supplierId: e.target.value }))} className={inputCls}>
          <option value="">Todos los proveedores</option>
          {(suppliers ?? []).map((s) => (<option key={s.id} value={s.id}>{s.razon_social}</option>))}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} title="Desde" className={inputCls} />
        <input type="date" value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} title="Hasta" className={inputCls} />
        <div className="flex gap-2">
          <input type="number" value={f.min} onChange={(e) => setF((s) => ({ ...s, min: e.target.value }))} placeholder="Monto mín" className={`${inputCls} w-full`} />
          <input type="number" value={f.max} onChange={(e) => setF((s) => ({ ...s, max: e.target.value }))} placeholder="máx" className={`${inputCls} w-full`} />
        </div>
      </div>
      {anyFilter && (
        <button onClick={() => setF(EMPTY_FILTERS)} className="mb-3 text-[12.5px] font-bold text-[#556A7C] underline">Limpiar filtros</button>
      )}

      {isLoading && <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando facturas…</div>}

      {!isLoading && (invoices ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center py-[50px] text-center text-[#5E6E7E]">
          <div className="text-[16px] font-bold text-[#556A7C]">Sin facturas archivadas</div>
          <div className="mt-[3px] text-[13.5px] text-[#5E6E7E]">Las facturas recepcionadas desde Stock aparecerán aquí.</div>
        </div>
      )}

      {!isLoading && (invoices ?? []).length > 0 && rows.length === 0 && (
        <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Sin resultados para los filtros aplicados.</div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-[#F7FAF8] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                <th className="px-4 py-2.5">Proveedor</th>
                <th className="px-4 py-2.5">Folio</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-[#EEF1F6]">
                  <td className="px-4 py-2.5 font-bold text-[#0F2A1B]">{inv.supplierName}</td>
                  <td className="px-4 py-2.5 text-[#2A3A2E]">{inv.folio ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[#2A3A2E]">{fmtDateCL(inv.issued_at)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-[#0F2A1B]">{fmtCLP(inv.total ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleDownload(inv.id, inv.pdf_path)} disabled={downloadingId === inv.id || !inv.pdf_path}
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#2A3A2E] disabled:opacity-50"
                      title={inv.pdf_path ? "Descargar PDF de la factura" : "Sin PDF archivado"}>
                      {downloadingId === inv.id ? "Generando…" : "Descargar PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
