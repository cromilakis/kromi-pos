import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke(cmd: string, args: Record<string, unknown>): Promise<void> {
  if (!isTauri) { console.warn(`[print] ${cmd} omitido (no-Tauri)`, args); return; }
  await invoke(cmd, args);
}

export const printReceipt = (payload: unknown) => safeInvoke("print_receipt", { payload });
export const printQuote = (payload: unknown) => safeInvoke("print_quote", { payload });
export const printCierre = (payload: unknown) => safeInvoke("print_cierre", { payload });
export const printCreditNote = (payload: unknown) => safeInvoke("print_credit_note", { payload });
