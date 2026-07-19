import { supabase } from "@/lib/supabase";

export interface FoliosInfo {
  sinUso: number;
  maxRequestable: number | null;
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

/** Consulta folios sin uso y el máximo solicitable de un tipo de DTE, vía la
 *  Edge Function `folios`. `maxRequestable` es `null` cuando el tipo no tiene límite. */
export async function consultarFolios(tipoDte: number): Promise<FoliosInfo> {
  const { data, error } = await supabase.functions.invoke("folios", { body: { action: "consultar", tipoDte } });
  if (error) throw new Error(await extractErrorMessage(error));
  return { sinUso: data?.sinUso ?? 0, maxRequestable: data?.maxRequestable ?? null };
}

/** Solicita folios (CAF) para un tipo de DTE, vía la Edge Function `folios`. Lanza si
 *  la solicitud falla. */
export async function solicitarFolios(tipoDte: number, cantidad: number): Promise<void> {
  const { data, error } = await supabase.functions.invoke("folios", { body: { action: "solicitar", tipoDte, cantidad } });
  if (error) throw new Error(await extractErrorMessage(error));
  if (data?.status === "error") throw new Error(data.message);
}
