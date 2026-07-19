import { describe, it, expect } from "vitest";
import { computeTotals, resolveDiscount, discountedPrice, fmtCLP, globalDiscount } from "./money";

describe("discountedPrice", () => {
  it("aplica el % de descuento al precio unitario", () => {
    expect(discountedPrice(10000, 20)).toBe(8000);
    expect(discountedPrice(10000, 0)).toBe(10000);
    expect(discountedPrice(9990, 10)).toBe(9990 - Math.round(9990 * 0.1));
  });
});

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

describe("globalDiscount", () => {
  it("descuento comercial sin canje", () => {
    expect(globalDiscount(1799, 0)).toBe(1799);
  });
  it("canje: el global comercial es 0 (discount_amount == points_discount)", () => {
    expect(globalDiscount(2000, 2000)).toBe(0);
  });
  it("nunca negativo", () => {
    expect(globalDiscount(0, 0)).toBe(0);
  });
});
