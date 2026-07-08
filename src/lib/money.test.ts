import { describe, it, expect } from "vitest";
import { computeTotals, fmtCLP } from "./money";

describe("computeTotals", () => {
  it("suma total, deriva neto/iva (IVA incluido) e items", () => {
    const r = computeTotals([{ qty: 2, price: 14990 }, { qty: 1, price: 5000 }]);
    expect(r.total).toBe(34980);
    expect(r.neto).toBe(Math.round(34980 / 1.19));
    expect(r.iva).toBe(34980 - Math.round(34980 / 1.19));
    expect(r.items).toBe(3);
  });
  it("carrito vacío = ceros", () => {
    expect(computeTotals([])).toEqual({ total: 0, neto: 0, iva: 0, items: 0 });
  });
});

describe("fmtCLP", () => {
  it("formatea CLP sin decimales con separador de miles", () => {
    expect(fmtCLP(14990)).toBe("$14.990");
  });
});
