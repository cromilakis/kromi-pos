import { toast } from "sonner";

/** Muestra al usuario un mensaje amigable (enmascarado) y envía el detalle técnico
 *  a la consola para depuración. Usar en catch en vez de exponer `e.message` en el toast. */
export function notifyError(userMessage: string, err?: unknown): void {
  if (err !== undefined) console.error("[error]", userMessage, err);
  toast.error(userMessage);
}

/** Extrae un mensaje legible de cualquier error. Los errores de Supabase
 *  (PostgrestError, StorageError) son objetos planos con `.message`, no
 *  instancias de Error, por lo que `${e}` daría "[object Object]". */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error_description === "string" && o.error_description) return o.error_description;
    if (typeof o.details === "string" && o.details) return o.details;
  }
  return String(e);
}

/** Traduce errores comunes de Supabase Auth a mensajes accionables en español. */
export function authErrorEs(error: { message?: string } | null | undefined): string {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "RUT o PIN incorrecto.";
  if (m.includes("email not confirmed")) return "La cuenta no está confirmada.";
  if (m.includes("network") || m.includes("failed to fetch")) return "Sin conexión con el servidor.";
  return "No se pudo iniciar sesión. Intenta nuevamente.";
}
