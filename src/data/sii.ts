import { supabase } from "@/lib/supabase";

export interface EmitirResult {
  status: "emitida" | "rechazada" | "error";
  folio?: number;
  timbre_png?: string | null;
  message?: string;
}

export interface PdfResult {
  status: "ok" | "error";
  pdf_base64?: string;
  message?: string;
}

/** Emite (o recupera si ya estaba emitida) la boleta electrónica de una venta vía
 *  la Edge Function `issue-receipt`. No lanza: devuelve el estado para decidir la impresión. */
export async function issueReceipt(saleId: string): Promise<EmitirResult> {
  const { data, error } = await supabase.functions.invoke("issue-receipt", { body: { sale_id: saleId } });
  if (error) {
    // FunctionsHttpError: el mensaje útil viene en el body de la respuesta (no en error.message).
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const raw = await ctx.text();
        try { message = JSON.parse(raw)?.message ?? raw; } catch { message = raw || message; }
      }
    } catch { /* noop */ }
    return { status: "error", message };
  }
  return data as EmitirResult;
}

/** Emite (o recupera si ya estaba emitida) la nota de crédito electrónica vía
 *  la Edge Function `issue-credit-note`. No lanza: devuelve el estado para decidir la impresión. */
export async function issueCreditNoteDte(creditNoteId: string): Promise<EmitirResult> {
  const { data, error } = await supabase.functions.invoke("issue-credit-note", { body: { credit_note_id: creditNoteId } });
  if (error) {
    // FunctionsHttpError: el mensaje útil viene en el body de la respuesta (no en error.message).
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const raw = await ctx.text();
        try { message = JSON.parse(raw)?.message ?? raw; } catch { message = raw || message; }
      }
    } catch { /* noop */ }
    return { status: "error", message };
  }
  return data as EmitirResult;
}

/** Descarga el PDF oficial del DTE (boleta o factura) de una venta ya emitida, vía
 *  la Edge Function `dte-pdf`. No lanza: devuelve el estado para decidir qué mostrar. */
export async function getDtePdf(saleId: string): Promise<PdfResult> {
  const { data, error } = await supabase.functions.invoke("dte-pdf", { body: { sale_id: saleId } });
  if (error) {
    // FunctionsHttpError: el mensaje útil viene en el body de la respuesta (no en error.message).
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const raw = await ctx.text();
        try { message = JSON.parse(raw)?.message ?? raw; } catch { message = raw || message; }
      }
    } catch { /* noop */ }
    return { status: "error", message };
  }
  return data as PdfResult;
}
