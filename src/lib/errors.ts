/** Traduce errores comunes de Supabase Auth a mensajes accionables en español. */
export function authErrorEs(error: { message?: string } | null | undefined): string {
  const m = (error?.message ?? "").toLowerCase();
  if (m.includes("invalid login credentials")) return "RUT o PIN incorrecto.";
  if (m.includes("email not confirmed")) return "La cuenta no está confirmada.";
  if (m.includes("network") || m.includes("failed to fetch")) return "Sin conexión con el servidor.";
  return "No se pudo iniciar sesión. Intenta nuevamente.";
}
