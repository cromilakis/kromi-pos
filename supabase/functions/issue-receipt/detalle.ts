export interface DteLine {
  name_snapshot: string;
  price_snapshot: number;
  qty: number;
  discount_amount?: number;
}

export interface DetalleItem {
  NroLinDet: string;
  NmbItem: string;
  QtyItem: string;
  UnmdItem: string;
  PrcItem: string;
  MontoItem: string;
  DescuentoMonto?: number;
}

/**
 * Construye el Detalle del DTE distribuyendo el descuento GLOBAL entre las
 * líneas (sin DscRcgGlobal), de modo que Σ MontoItem = Σ(precio×qty) − Σ dcto
 * de línea − descuento global. El SII no reconcilia un DscRcgGlobal en boleta
 * bruta (genera reparo "Monto Total No Cuadra con Parciales"); distribuir en
 * líneas hace la cuadratura trivial.
 *
 * Unidad de trabajo: boleta = bruto (IVA incluido); factura = neto (÷1,19).
 * El remanente de redondeo del prorrateo se ajusta en la última línea para que
 * Σ extra = descuento global exacto.
 */
export function buildDetalle(lines: DteLine[], globalDiscount: number, esFactura: boolean): DetalleItem[] {
  const toWork = (n: number) => (esFactura ? Math.round(n / 1.19) : n);
  const globalWork = toWork(globalDiscount);

  const calc = lines.map((l) => {
    const prc = toWork(l.price_snapshot);
    const lineDesc = toWork(l.discount_amount ?? 0);
    return { l, prc, lineDesc, base: prc * l.qty - lineDesc };
  });
  const sumBase = calc.reduce((s, c) => s + c.base, 0);

  let assigned = 0;
  return calc.map((c, i) => {
    const extra = i === calc.length - 1
      ? globalWork - assigned
      : (sumBase > 0 ? Math.round((globalWork * c.base) / sumBase) : 0);
    if (i < calc.length - 1) assigned += extra;

    const desc = c.lineDesc + extra;
    const monto = c.prc * c.l.qty - desc;
    const d: DetalleItem = {
      NroLinDet: String(i + 1),
      NmbItem: c.l.name_snapshot,
      QtyItem: String(c.l.qty),
      UnmdItem: "un",
      PrcItem: String(c.prc),
      MontoItem: String(monto),
    };
    if (desc > 0) d.DescuentoMonto = desc;
    return d;
  });
}
