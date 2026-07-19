export interface Line { qty: number; price: number; discount?: number; }
export interface Totals { total: number; neto: number; iva: number; items: number; discount: number; }

/** Monto en pesos de un descuento, capado a `base`. kind null/valor<=0 → 0. */
export function resolveDiscount(base: number, kind: "pct" | "amount" | null, value: number): number {
  if (!kind || !value || value <= 0) return 0;
  const raw = kind === "pct" ? Math.round((base * value) / 100) : value;
  return Math.max(0, Math.min(base, raw));
}

/** Descuento global comercial de una venta: el total del descuento global
 *  (`discount_amount`) menos el canje de puntos (`points_discount`), que son
 *  mutuamente excluyentes. Nunca negativo. */
export function globalDiscount(discountAmount: number, pointsDiscount: number): number {
  return Math.max(0, (discountAmount ?? 0) - (pointsDiscount ?? 0));
}

/** Precio unitario con el descuento de catálogo (%) aplicado. */
export function discountedPrice(price: number, pct: number): number {
  if (!pct || pct <= 0) return price;
  return Math.max(0, price - resolveDiscount(price, "pct", pct));
}

export function computeTotals(lines: Line[], totalDiscount = 0): Totals {
  const bruto = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const lineDisc = lines.reduce((s, l) => s + (l.discount ?? 0), 0);
  const items = lines.reduce((s, l) => s + l.qty, 0);
  const sub = Math.max(0, bruto - lineDisc);
  const appliedTotalDisc = Math.min(totalDiscount, sub);
  const total = sub - appliedTotalDisc;
  const neto = Math.round(total / 1.19);
  return { total, neto, iva: total - neto, items, discount: lineDisc + appliedTotalDisc };
}

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
export function fmtCLP(n: number): string {
  return CLP.format(n).replace(/\s/g, "");
}
