/** Formatea una fecha para mostrar en Chile como dd-mm-yyyy.
 *
 *  Los valores `date` de Postgres llegan como "YYYY-MM-DD" (sin hora). Si se
 *  construyen con `new Date("YYYY-MM-DD")` se interpretan como medianoche UTC y,
 *  al mostrarse en zona horaria de Chile (UTC-4/-3), retroceden un día. Por eso
 *  los date-only se formatean por componentes, sin pasar por Date.
 */
export function fmtDateCL(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${d}-${m}-${y}`;
  }
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}
