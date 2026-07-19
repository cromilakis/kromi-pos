import { supabase } from "@/lib/supabase";

/** Info de folios de un tipo de DTE devuelta por la consulta multi-tipo. `maxRequestable`
 *  es `null` cuando el tipo no tiene límite. `error`/`maxError` reflejan fallos parciales
 *  (sin-uso o disponibles respectivamente) que no abortan la consulta de los demás tipos. */
export interface FolioTipoInfo {
  tipoDte: number;
  sinUso: number;
  maxRequestable: number | null;
  maxError?: string;
  error?: string;
}

async function extractErrorMessage(error: { message: string; context?: Response }): Promise<string> {
  let message = error.message;
  try {
    const ctx = error.context;
    if (ctx && typeof ctx.text === "function") {
      const raw = await ctx.text();
      try { message = JSON.parse(raw)?.message ?? raw; } catch { message = raw || message; }
    }
  } catch { /* noop */ }
  return message;
}

/** Consulta folios sin uso y el máximo solicitable para varios tipos de DTE en UNA sola
 *  invocación de la Edge Function `folios` (reutiliza un único token de SimpleFactura para
 *  todos los tipos). Por defecto consulta boleta (39), factura (33) y nota de crédito (61). */
export async function consultarFolios(tipos?: number[]): Promise<FolioTipoInfo[]> {
  const { data, error } = await supabase.functions.invoke("folios", {
    body: { action: "consultar", tipos: tipos ?? [39, 33, 61] },
  });
  if (error) throw new Error(await extractErrorMessage(error));
  return Array.isArray(data?.results) ? data.results : [];
}

/** Solicita folios (CAF) para un tipo de DTE, vía la Edge Function `folios`. Lanza si
 *  la solicitud falla. */
export async function solicitarFolios(tipoDte: number, cantidad: number): Promise<void> {
  const { data, error } = await supabase.functions.invoke("folios", { body: { action: "solicitar", tipoDte, cantidad } });
  if (error) throw new Error(await extractErrorMessage(error));
  if (data?.status === "error") throw new Error(data.message);
}
