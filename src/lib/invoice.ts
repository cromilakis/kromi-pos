export interface ExtractedLine { supplier_code: string; description: string; qty: number; unit_cost: number; line_total: number; }
export interface Extraction {
  proveedor: { razon_social: string; rut: string };
  documento: { tipo: string; folio: string; fecha: string; neto: number; iva: number; total: number };
  lineas: ExtractedLine[];
}

const int = (n: unknown) => Math.round(Number(n) || 0);

const DD_MM_YYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normaliza una fecha de factura chilena a ISO YYYY-MM-DD.
 * - "dd/mm/yyyy" (o "d/m/yyyy") -> "yyyy-mm-dd"
 * - ya en ISO "yyyy-mm-dd" -> se deja igual
 * - formato no reconocido -> se deja igual (sin lanzar)
 */
export function toIsoDate(s: string): string {
  if (!s) return s;
  if (ISO_DATE.test(s)) return s;
  const m = DD_MM_YYYY.exec(s);
  if (!m) return s;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function normalizeExtraction(raw: any): Extraction {
  return {
    proveedor: { razon_social: String(raw?.proveedor?.razon_social ?? "").trim(), rut: String(raw?.proveedor?.rut ?? "").trim() },
    documento: {
      tipo: String(raw?.documento?.tipo ?? ""), folio: String(raw?.documento?.folio ?? ""),
      fecha: toIsoDate(String(raw?.documento?.fecha ?? "")),
      neto: int(raw?.documento?.neto), iva: int(raw?.documento?.iva), total: int(raw?.documento?.total),
    },
    lineas: (raw?.lineas ?? []).map((l: any) => ({
      supplier_code: String(l?.supplier_code ?? "").trim(), description: String(l?.description ?? "").trim(),
      qty: int(l?.qty), unit_cost: int(l?.unit_cost), line_total: int(l?.line_total),
    })),
  };
}

export function checkLineTotal(l: ExtractedLine): boolean { return l.qty * l.unit_cost === l.line_total; }
export function totalsMatch(computed: number, docTotal: number, tol = 2): boolean { return Math.abs(computed - docTotal) <= tol; }
export function sumLineTotals(lines: ExtractedLine[]): number { return lines.reduce((s, l) => s + l.line_total, 0); }
