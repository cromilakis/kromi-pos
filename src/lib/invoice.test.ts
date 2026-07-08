import { describe, it, expect } from "vitest";
import { normalizeExtraction, checkLineTotal, totalsMatch } from "./invoice";

describe("normalizeExtraction", () => {
  it("coacciona montos a enteros y conserva líneas", () => {
    const r = normalizeExtraction({
      proveedor: { razon_social: "Floriterra", rut: "78.964.380-6" },
      documento: { tipo: "factura", folio: "59763", fecha: "2026-07-02", neto: 493210, iva: 93710, total: 586920 },
      lineas: [{ supplier_code: "00T017", description: "CTENANTHE", qty: 3, unit_cost: 4990, line_total: 14970 }],
    });
    expect(r.documento.total).toBe(586920);
    expect(r.lineas[0].qty).toBe(3);
  });
});

describe("checkLineTotal / totalsMatch", () => {
  it("detecta que qty*unit_cost coincide con line_total", () => {
    expect(checkLineTotal({ qty: 3, unit_cost: 4990, line_total: 14970 } as any)).toBe(true);
    expect(checkLineTotal({ qty: 3, unit_cost: 4990, line_total: 999 } as any)).toBe(false);
  });
  it("totalsMatch tolera diferencia de redondeo pequeña", () => {
    expect(totalsMatch(493210, 493210)).toBe(true);
    expect(totalsMatch(493210, 490000)).toBe(false);
  });
});
