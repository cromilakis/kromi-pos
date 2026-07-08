import { supabase } from "@/lib/supabase";

export interface EmitirResult {
  status: "emitida" | "rechazada" | "error";
  folio?: number;
  timbre_png?: string | null;
  message?: string;
}

/** Emite (o recupera si ya estaba emitida) la boleta electrónica de una venta vía
 *  la Edge Function `emitir-boleta`. No lanza: devuelve el estado para decidir la impresión. */
export async function emitirBoleta(saleId: string): Promise<EmitirResult> {
  const { data, error } = await supabase.functions.invoke("emitir-boleta", { body: { sale_id: saleId } });
  if (error) return { status: "error", message: error.message };
  return data as EmitirResult;
}
