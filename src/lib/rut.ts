/** Normaliza un RUT: sin puntos ni guion, minúscula. Paridad con public.normalize_rut. */
export function normRut(rut: string): string {
  return (rut ?? "").trim().replace(/[.\-]/g, "").toLowerCase();
}

/** Email sintético interno usado como credencial en Supabase Auth. */
export function rutToEmail(rut: string): string {
  return `${normRut(rut)}@pos.kromi.local`;
}

/** Formatea un RUT (normalizado o no) como "cuerpo-DV", con el DV en mayúscula. */
export function formatRutDashed(rut: string): string {
  const limpio = normRut(rut);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  return `${cuerpo}-${dv}`;
}
