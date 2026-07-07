export interface Line { qty: number; price: number; }
export interface Totals { total: number; neto: number; iva: number; items: number; }

export function computeTotals(lines: Line[]): Totals {
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const items = lines.reduce((s, l) => s + l.qty, 0);
  const neto = Math.round(total / 1.19);
  return { total, neto, iva: total - neto, items };
}

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export function fmtCLP(n: number): string {
  return CLP.format(n).replace(/\s/g, "");
}
