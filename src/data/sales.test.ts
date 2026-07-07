import { describe, it, expect } from "vitest";
import { summarizeSales } from "./sales";

describe("summarizeSales", () => {
  it("total, conteo y promedio de ventas del día", () => {
    const r = summarizeSales([{ total: 10000 }, { total: 20000 }] as any);
    expect(r).toEqual({ total: 30000, count: 2, avg: 15000 });
  });
  it("sin ventas = ceros y promedio 0", () => {
    expect(summarizeSales([])).toEqual({ total: 0, count: 0, avg: 0 });
  });
});
