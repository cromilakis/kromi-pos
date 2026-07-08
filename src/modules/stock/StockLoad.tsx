import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { extractInvoice } from "@/data/purchases";
import { useProductsWithStock, upsertInventory } from "@/data/stock";
import { parseStockCsv, matchStockRows, type StockMatchResult } from "@/lib/stockCsv";
import type { Extraction } from "@/lib/invoice";
import { InvoiceConfirm } from "./InvoiceConfirm";

interface StockLoadProps {
  onClose: () => void;
  onDone: () => void;
}

/**
 * Pantalla unificada de carga de stock: una zona de arrastrar y soltar que acepta
 * CSV (suma stock por código interno) y PDF (recepción de factura vía OpenAI).
 */
export function StockLoad({ onClose, onDone }: StockLoadProps) {
  const { profile } = useAuth();
  const { branch } = useWork();
  const businessId = profile?.business_id;
  const branchId = branch?.id;
  const qc = useQueryClient();
  const { data: products } = useProductsWithStock(businessId, branchId);

  const fileRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [applying, setApplying] = useState(false);
  const [pdf, setPdf] = useState<{ pdf_path: string; extraction: Extraction } | null>(null);
  const [csv, setCsv] = useState<{ fileName: string; result: StockMatchResult; error: string | null } | null>(null);

  function backToDrop() {
    setPdf(null);
    setCsv(null);
  }

  function handleFile(file: File) {
    const name = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
    const isCsv = file.type === "text/csv" || name.endsWith(".csv");
    if (isPdf) return void analyzePdf(file);
    if (isCsv) return readCsv(file);
    toast.error("Solo se aceptan archivos CSV o PDF.");
  }

  async function analyzePdf(file: File) {
    cancelledRef.current = false;
    setBusy(true);
    try {
      const data = await extractInvoice(file);
      if (cancelledRef.current) return;
      setPdf(data);
    } catch (err) {
      if (cancelledRef.current) return;
      toast.error(`No se pudo analizar la factura: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }

  function readCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const entries = parseStockCsv(String(reader.result ?? ""));
        setCsv({ fileName: file.name, result: matchStockRows(entries, products ?? []), error: null });
      } catch (err) {
        setCsv({ fileName: file.name, result: { rows: [], unknown: [] }, error: `No se pudo leer el archivo: ${err instanceof Error ? err.message : "formato inválido"}` });
      }
    };
    reader.readAsText(file);
  }

  async function confirmCsv() {
    if (!csv || !csv.result.rows.length) return;
    if (!branchId) {
      toast.error("No hay sucursal seleccionada.");
      return;
    }
    setApplying(true);
    try {
      await Promise.all(csv.result.rows.map((r) => upsertInventory(r.id, branchId, r.next)));
      toast.success(`Stock actualizado para ${csv.result.rows.length} producto(s).`);
      qc.invalidateQueries({ queryKey: ["products-with-stock"] });
      qc.invalidateQueries({ queryKey: ["critical-stock"] });
      onDone();
    } catch (e) {
      toast.error(`No se pudo actualizar el stock: ${e instanceof Error ? e.message : e}`);
    } finally {
      setApplying(false);
    }
  }

  function pick() {
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }

  // PDF: pasa el control a la pantalla de confirmación de factura
  if (pdf) {
    return <InvoiceConfirm pdfPath={pdf.pdf_path} extraction={pdf.extraction} onCancel={backToDrop} onDone={onDone} />;
  }

  // CSV: preview antes de aplicar
  if (csv) {
    return (
      <div className="w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6">
        <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Confirmar carga de stock</div>
        <div className="mb-4 text-[13px] text-[#556A7C]">{csv.fileName}</div>
        {csv.error && <div className="mb-3 rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-[13.5px] font-semibold text-[#9a2533]">{csv.error}</div>}
        {csv.result.rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-[#E1E5EE]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#F7FAF8] text-left text-[11px] font-bold uppercase tracking-[.06em] text-[#5E6E7E]">
                  <th className="px-3 py-2">Código interno</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Suma</th>
                  <th className="px-3 py-2 text-right">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {csv.result.rows.map((r) => (
                  <tr key={r.id} className="border-t border-[#EEF1F6]">
                    <td className="px-3 py-1.5 font-semibold text-[#556A7C]">{r.internal_code}</td>
                    <td className="px-3 py-1.5 font-bold text-[#0F2A1B]">{r.name}</td>
                    <td className="px-3 py-1.5 text-right text-[#556A7C]">{r.current}</td>
                    <td className="px-3 py-1.5 text-right font-bold" style={{ color: "var(--brand)" }}>+{r.add}</td>
                    <td className="px-3 py-1.5 text-right font-black text-[#0F2A1B]">{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!csv.error && csv.result.rows.length === 0 && (
          <div className="rounded-xl bg-[#FBF1E0] px-3.5 py-2.5 text-[13px] font-semibold text-[#9a6a1e]">
            No se encontró ningún producto para los códigos del archivo.
          </div>
        )}
        {csv.result.unknown.length > 0 && (
          <div className="mt-3 text-[12.5px] text-[#9a6a1e]">
            <b>{csv.result.unknown.length}</b> código(s) no reconocido(s) (se ignoran): {csv.result.unknown.join(", ")}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={backToDrop} disabled={applying}
            className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-50">
            Elegir otro archivo
          </button>
          <button onClick={confirmCsv} disabled={applying || !csv.result.rows.length}
            className="rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: "var(--brand)" }}>
            {applying ? "Guardando…" : "Confirmar carga"}
          </button>
        </div>
      </div>
    );
  }

  // Estado de análisis de PDF
  if (busy) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-[420px] max-w-full rounded-[20px] border border-[#E1E5EE] bg-white p-6 text-center">
          <div className="mb-1 text-[17px] font-black text-[#0F2A1B]">Cargar stock</div>
          <div className="flex flex-col items-center gap-3 py-7">
            <span className="inline-block h-9 w-9 animate-spin rounded-full" style={{ border: "3px solid #E7EFE8", borderTopColor: "var(--brand)" }} />
            <div className="text-[14px] font-bold text-[#0F2A1B]">Procesando Factura</div>
            <div className="text-[12px] font-normal text-[#5E6E7E]">Puede tardar unos segundos. Puedes cancelar.</div>
          </div>
          <button onClick={() => { cancelledRef.current = true; setBusy(false); }}
            className="mt-1 w-full rounded-[13px] border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // Dropzone
  return (
    <div className="flex justify-center py-4">
      <div className="w-[560px] max-w-full">
        <div
          onClick={pick}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed bg-white px-6 py-14 text-center transition-colors"
          style={{ borderColor: dragOver ? "var(--brand)" : "#CBD5E1", background: dragOver ? "color-mix(in srgb, var(--brand) 6%, #fff)" : "#fff" }}
        >
          <div className="text-[17px] font-black text-[#0F2A1B]">Arrastra un archivo aquí</div>
          <div className="text-[13px] text-[#556A7C]">o haz clic para seleccionar. Acepta <b>CSV</b> (suma stock por código interno) o <b>PDF</b> de factura (extrae con IA).</div>
          <div className="mt-2 inline-flex rounded-[12px] px-[18px] py-2.5 text-sm font-bold text-white" style={{ background: "var(--brand)" }}>
            Seleccionar archivo
          </div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="hidden" />
        <button onClick={onClose} className="mt-3 w-full rounded-[13px] border border-[#E1E5EE] bg-white px-[18px] py-3 text-sm font-bold text-[#2A3A2E]">
          Volver a stock
        </button>
      </div>
    </div>
  );
}
