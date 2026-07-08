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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={busy ? undefined : handleClose}>
      <div className="w-[420px] max-w-full rounded-[20px] bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Cargar desde factura</div>
        <div className="mb-5 text-[13px] leading-relaxed text-[#7C95A8]">
          Sube el PDF de la factura del proveedor. La analizaremos automáticamente para armar la recepción de stock.
        </div>
        {busy ? (
          <div className="py-7 text-[14px] font-bold text-[#7C95A8]">Analizando factura…<div className="mt-1 text-[12px] font-normal text-[#9aa8bd]">Puede tardar unos segundos. Puedes cancelar.</div></div>
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
          Cancelar
        </button>
      </div>
    </div>
  );
}
