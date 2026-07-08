import { useState } from "react";
import { toast } from "sonner";
import { usePurchaseInvoices, invoiceDownloadUrl } from "@/data/purchases";
import { fmtCLP } from "@/lib/money";

interface PurchaseInvoicesListProps {
  businessId: string | undefined;
  onClose: () => void;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** El join `supplier:supplier_id(razon_social)` se tipa como arreglo; tomamos el primer elemento. */
function supplierName(supplier: { razon_social: string }[] | { razon_social: string } | null | undefined): string {
  if (!supplier) return "—";
  const row = Array.isArray(supplier) ? supplier[0] : supplier;
  return row?.razon_social ?? "—";
}

/** Listado de facturas de compra archivadas, con descarga del PDF original vía URL firmada. */
export function PurchaseInvoicesList({ businessId, onClose }: PurchaseInvoicesListProps) {
  const { data: invoices, isLoading } = usePurchaseInvoices(businessId);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const rows = invoices ?? [];

  async function handleDownload(id: string, pdfPath: string | null) {
    if (!pdfPath) {
      toast.error("Esta factura no tiene un PDF archivado.");
      return;
    }
    setDownloadingId(id);
    try {
      const url = await invoiceDownloadUrl(pdfPath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(`No se pudo generar el enlace de descarga: ${err instanceof Error ? err.message : err}`);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[720px] max-w-full flex-col overflow-hidden rounded-[20px] bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[#F0F2F7] px-6 py-5">
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>
              Compras
            </div>
            <div className="text-[17px] font-black text-[#0F2A1B]">Facturas de compra</div>
          </div>
          <button
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-[#E1E5EE] bg-white text-[#7C95A8]"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading && <div className="py-10 text-center text-[13.5px] text-[#9aa8bd]">Cargando facturas…</div>}

          {!isLoading && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-[50px] text-center text-[#9aa8bd]">
              <div className="text-[16px] font-bold text-[#7C95A8]">Sin facturas archivadas</div>
              <div className="mt-[3px] text-[13.5px] text-[#9aa8bd]">Las facturas recepcionadas desde Stock aparecerán aquí.</div>
            </div>
          )}

          {!isLoading && rows.length > 0 && (
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-[#F0F2F7] text-left text-[11.5px] font-bold uppercase tracking-[.06em] text-[#9aa8bd]">
                  <th className="py-2 pr-3 font-bold">Proveedor</th>
                  <th className="py-2 pr-3 font-bold">Folio</th>
                  <th className="py-2 pr-3 font-bold">Fecha</th>
                  <th className="py-2 pr-3 text-right font-bold">Total</th>
                  <th className="py-2 pl-3 text-right font-bold">PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id} className="border-b border-[#F0F2F7] last:border-0">
                    <td className="py-2.5 pr-3 font-bold text-[#0F2A1B]">{supplierName(inv.supplier)}</td>
                    <td className="py-2.5 pr-3 text-[#2A3A2E]">{inv.folio ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-[#2A3A2E]">{fmtDate(inv.issued_at)}</td>
                    <td className="py-2.5 pr-3 text-right font-bold text-[#0F2A1B]">{fmtCLP(inv.total ?? 0)}</td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        onClick={() => handleDownload(inv.id, inv.pdf_path)}
                        disabled={downloadingId === inv.id || !inv.pdf_path}
                        className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E1E5EE] bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#2A3A2E] disabled:opacity-50"
                        title={inv.pdf_path ? "Descargar PDF de la factura" : "Sin PDF archivado"}
                      >
                        {downloadingId === inv.id ? "Generando…" : "Descargar PDF"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
