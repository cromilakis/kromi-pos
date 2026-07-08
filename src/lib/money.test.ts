import { describe, it, expect } from "vitest";
import { computeTotals, resolveDiscount, fmtCLP } from "./money";

describe("computeTotals", () => {
  it("suma total, deriva neto/iva (IVA incluido) e items", () => {
    const r = computeTotals([{ qty: 2, price: 14990 }, { qty: 1, price: 5000 }]);
    expect(r.total).toBe(34980);
    expect(r.neto).toBe(Math.round(34980 / 1.19));
    expect(r.iva).toBe(34980 - Math.round(34980 / 1.19));
    expect(r.items).toBe(3);
  });
  it("carrito vacío = ceros", () => {
    expect(computeTotals([])).toEqual({ total: 0, neto: 0, iva: 0, items: 0, discount: 0 });
  });
});

describe("resolveDiscount", () => {
  it("resuelve porcentaje y monto, capado a la base", () => {
    expect(resolveDiscount(10000, "pct", 10)).toBe(1000);
    expect(resolveDiscount(10000, "amount", 3000)).toBe(3000);
    expect(resolveDiscount(10000, "amount", 99999)).toBe(10000);
    expect(resolveDiscount(10000, null, 50)).toBe(0);
    expect(resolveDiscount(10000, "pct", 0)).toBe(0);
  });
});

describe("computeTotals con descuentos", () => {
  it("descuenta por línea y sobre el total (IVA incluido)", () => {
    const t = computeTotals([{ qty: 2, price: 5000, discount: 1000 }], 900);
    expect(t.total).toBe(8100);
    expect(t.discount).toBe(1900);
    expect(t.neto).toBe(Math.round(8100 / 1.19));
    expect(t.iva).toBe(8100 - Math.round(8100 / 1.19));
    expect(t.items).toBe(2);
  });
  it("sin descuentos, discount = 0", () => {
    const t = computeTotals([{ qty: 1, price: 11900 }]);
    expect(t.total).toBe(11900);
    expect(t.discount).toBe(0);
  });
});

describe("fmtCLP", () => {
  it("formatea CLP sin decimales con separador de miles", () => {
    expect(fmtCLP(14990)).toBe("$14.990");
  });
});
