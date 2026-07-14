import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke(cmd: string, args: Record<string, unknown>): Promise<void> {
  if (!isTauri) { console.warn(`[print] ${cmd} omitido (no-Tauri)`, args); return; }
  await invoke(cmd, args);
}

export const printReceipt = (payload: unknown) => safeInvoke("print_receipt", { payload });
export const printQuote = (payload: unknown) => safeInvoke("print_quote", { payload });
export const printCierre = (payload: unknown) => safeInvoke("print_cierre", { payload });

export type CreditNotePayload = {
  negocio: unknown;
  folio: number;
  fecha: string;
  hora: string;
  sale_folio?: number | null;
  metodo: string;
  motivo: string;
  items: Array<{ nombre: string; qty: number; precio: number }>;
  neto: number;
  iva: number;
  total: number;
  /** Folio SII del DTE 61 (presente cuando la NC ya fue emitida). */
  dte_folio?: number;
  /** PNG del timbre (PDF417) en base64; puede faltar aunque la NC esté emitida. */
  timbre_png?: string | null;
};

export const printCreditNote = (payload: CreditNotePayload) => safeInvoke("print_credit_note", { payload });
