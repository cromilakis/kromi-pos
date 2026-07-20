import { describe, it, expect } from "vitest";
import { summarizeSales, cartToLines, isQuoteVigente } from "./sales";

describe("summarizeSales", () => {
  it("total, conteo y promedio de ventas del día", () => {
    const r = summarizeSales([{ total: 10000 }, { total: 20000 }] as any);
    expect(r).toEqual({ total: 30000, count: 2, avg: 15000, card: 0, cash: 0 });
  });
  it("sin ventas = ceros y promedio 0", () => {
    expect(summarizeSales([])).toEqual({ total: 0, count: 0, avg: 0, card: 0, cash: 0 });
  });
  it("suma total, promedio y desglosa por método", () => {
    const rows = [
      { total: 1000, method: "efectivo" },
      { total: 3000, method: "tarjeta" },
      { total: 2000, method: "efectivo" },
    ];
    const s = summarizeSales(rows);
    expect(s.total).toBe(6000);
    expect(s.count).toBe(3);
    expect(s.avg).toBe(2000);
    expect(s.cash).toBe(3000);
    expect(s.card).toBe(3000);
  });
});

describe("cartToLines", () => {
  it("mapea id→product_id, conserva qty y normaliza el descuento", () => {
    expect(cartToLines([{ id: "p1", qty: 2 }])).toEqual([{ product_id: "p1", qty: 2, disc_kind: null, disc_value: 0 }]);
    expect(cartToLines([{ id: "p2", qty: 1, disc_kind: "pct", disc_value: 10 }])).toEqual([
      { product_id: "p2", qty: 1, disc_kind: "pct", disc_value: 10 },
    ]);
  });
});

describe("isQuoteVigente", () => {
  const today = new Date("2026-07-07T10:00:00");
  it("fecha futura es vigente", () => {
    expect(isQuoteVigente("2026-07-14", today)).toBe(true);
  });
  it("hoy mismo (fin del día) es vigente", () => {
    expect(isQuoteVigente("2026-07-07", today)).toBe(true);
  });
  it("fecha pasada está vencida", () => {
    expect(isQuoteVigente("2026-07-01", today)).toBe(false);
  });
});
