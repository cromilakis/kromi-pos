export interface ExtractedLine { supplier_code: string; description: string; qty: number; unit_cost: number; line_total: number; }
export interface Extraction {
  proveedor: { razon_social: string; rut: string };
  documento: { tipo: string; folio: string; fecha: string; neto: number; iva: number; total: number };
  lineas: ExtractedLine[];
}

const int = (n: unknown) => Math.round(Number(n) || 0);

export function normalizeExtraction(raw: any): Extraction {
  return {
    proveedor: { razon_social: String(raw?.proveedor?.razon_social ?? "").trim(), rut: String(raw?.proveedor?.rut ?? "").trim() },
    documento: {
      tipo: String(raw?.documento?.tipo ?? ""), folio: String(raw?.documento?.folio ?? ""),
      fecha: String(raw?.documento?.fecha ?? ""),
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
