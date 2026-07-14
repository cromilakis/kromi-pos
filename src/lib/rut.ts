/** Normaliza un RUT: sin puntos ni guion, minúscula. Paridad con public.normalize_rut. */
export function normRut(rut: string): string {
  return (rut ?? "").trim().replace(/[.\-]/g, "").toLowerCase();
}

/** Email sintético interno usado como credencial en Supabase Auth. */
export function rutToEmail(rut: string): string {
  return `${normRut(rut)}@pos.kromi.local`;
}
