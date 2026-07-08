import { describe, it, expect } from "vitest";
import { normalizeExtraction, checkLineTotal, totalsMatch, toIsoDate } from "./invoice";

describe("toIsoDate", () => {
  it("convierte dd/mm/yyyy a ISO YYYY-MM-DD", () => {
    expect(toIsoDate("02/07/2026")).toBe("2026-07-02");
  });
  it("convierte d/m/yyyy (sin ceros) a ISO YYYY-MM-DD", () => {
    expect(toIsoDate("2/7/2026")).toBe("2026-07-02");
  });
  it("deja igual una fecha ya en ISO YYYY-MM-DD", () => {
    expect(toIsoDate("2026-07-02")).toBe("2026-07-02");
  });
  it("devuelve vacío si la entrada es vacía", () => {
    expect(toIsoDate("")).toBe("");
  });
  it("deja la fecha igual si el formato no se reconoce", () => {
    expect(toIsoDate("fecha inválida")).toBe("fecha inválida");
  });
});

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

  it("normaliza giro y dirección del proveedor (trim; default vacío)", () => {
    const out = normalizeExtraction({
      proveedor: { razon_social: "Floriterra", rut: "78.964.380-6", giro: "  Vivero  ", direccion: " Camino Real 123 " },
      documento: {}, lineas: [],
    });
    expect(out.proveedor.giro).toBe("Vivero");
    expect(out.proveedor.direccion).toBe("Camino Real 123");

    const out2 = normalizeExtraction({ proveedor: { razon_social: "X", rut: "1-9" }, documento: {}, lineas: [] });
    expect(out2.proveedor.giro).toBe("");
    expect(out2.proveedor.direccion).toBe("");
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
