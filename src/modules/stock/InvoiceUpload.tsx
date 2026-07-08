import { useRef, useState } from "react";
import { toast } from "sonner";
import { extractInvoice } from "@/data/purchases";
import type { Extraction } from "@/lib/invoice";
import { InvoiceConfirm } from "./InvoiceConfirm";

interface InvoiceUploadProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Flujo de recepción de compras: sube el PDF de una factura de proveedor, lo envía a analizar
 * y, al obtener la extracción, pasa el control a `InvoiceConfirm` para revisar y confirmar.
 */
export function InvoiceUpload({ onClose, onDone }: InvoiceUploadProps) {
  const [result, setResult] = useState<{ pdf_path: string; extraction: Extraction } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  // Cierra el modal aunque haya un análisis en curso: marca cancelado para
  // que el resultado tardío se ignore (no queda "pegado" en Analizando…).
  function handleClose() {
    cancelledRef.current = true;
    onClose();
  }

  function pickFile() {
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    cancelledRef.current = false;
    setBusy(true);
    try {
      const data = await extractInvoice(file);
      if (cancelledRef.current) return;
      setResult(data);
    } catch (err) {
      if (cancelledRef.current) return;
      toast.error(`No se pudo analizar la factura: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  if (result) {
    return <InvoiceConfirm pdfPath={result.pdf_path} extraction={result.extraction} onCancel={() => setResult(null)} onDone={onDone} />;
  }

  return (
    <div className="flex justify-center py-4">
      <div className="w-[420px] max-w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6 text-center">
        <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Cargar desde factura</div>
        {!busy && (
          <div className="mb-5 text-[13px] leading-relaxed text-[#7C95A8]">
            Sube el PDF de la factura del proveedor. La analizaremos automáticamente para armar la recepción de stock.
          </div>
        )}
        {busy ? (
          <div className="flex flex-col items-center gap-3 py-7">
            <span className="inline-block h-9 w-9 animate-spin rounded-full" style={{ border: "3px solid #E7EFE8", borderTopColor: "var(--brand)" }} />
            <div className="text-[14px] font-bold text-[#0F2A1B]">Procesando Factura</div>
            <div className="text-[12px] font-normal text-[#9aa8bd]">Puede tardar unos segundos. Puedes cancelar.</div>
          </div>
        ) : (
          <button
            onClick={pickFile}
            className="w-full rounded-[13px] px-[18px] py-3.5 text-sm font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            Subir factura (PDF)
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} className="hidden" />
        <button
          onClick={handleClose}
          className="mt-3 w-full rounded-[13px] border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]"
        >
          {busy ? "Cancelar" : "Volver a stock"}
        </button>
      </div>
    </div>
  );
}
