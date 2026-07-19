import { describe, it, expect } from "vitest";
import { buildDetalle } from "./detalle.ts";

const sum = (d: { MontoItem: string }[]) => d.reduce((s, x) => s + Number(x.MontoItem), 0);

describe("buildDetalle (boleta, bruto)", () => {
  it("una línea con descuento global: Σ MontoItem = total", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 8990, qty: 1 }], 899, false);
    expect(sum(d)).toBe(8091);
    expect(d[0].DescuentoMonto).toBe(899);
  });

  it("varias líneas + descuento que no divide exacto: cuadra al peso", () => {
    const lines = [
      { name_snapshot: "A", price_snapshot: 5000, qty: 2, discount_amount: 1000 },
      { name_snapshot: "B", price_snapshot: 8990, qty: 1 },
    ];
    const d = buildDetalle(lines, 1799, false);
    // Σ bruto = 10000 + 8990 = 18990; Σ dcto línea = 1000; base = 17990; − global 1799 = 16191
    expect(sum(d)).toBe(16191);
  });

  it("sin descuento global: MontoItem = bruto − dcto de línea", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 5000, qty: 2, discount_amount: 1000 }], 0, false);
    expect(sum(d)).toBe(9000);
    expect(d[0].DescuentoMonto).toBe(1000);
  });
});

describe("buildDetalle (factura, neto)", () => {
  it("lleva a neto y distribuye el global neto", () => {
    const d = buildDetalle([{ name_snapshot: "A", price_snapshot: 11900, qty: 1 }], 1190, true);
    // prc neto = round(11900/1.19)=10000; global neto = round(1190/1.19)=1000; monto = 9000
    expect(d[0].PrcItem).toBe("10000");
    expect(sum(d)).toBe(9000);
  });
});
