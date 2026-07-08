import { describe, it, expect } from "vitest";
import { parseStockCsv, matchStockRows } from "./stockCsv";

const products = [
  { id: "p1", name: "Ficus", internal_code: "001-ABC", stock: 5 },
  { id: "p2", name: "Cactus", internal_code: "001-XYZ", stock: 0 },
  { id: "p3", name: "Sin código", internal_code: null, stock: 3 },
];

describe("parseStockCsv", () => {
  it("ignora encabezado y parsea codigo,cantidad", () => {
    const out = parseStockCsv("codigo,cantidad\n001-ABC,3\n001-XYZ,2");
    expect(out).toEqual([{ codigo: "001-ABC", cantidad: 3 }, { codigo: "001-XYZ", cantidad: 2 }]);
  });
  it("acepta separador ; y comillas", () => {
    const out = parseStockCsv('"001-ABC";"4"');
    expect(out).toEqual([{ codigo: "001-ABC", cantidad: 4 }]);
  });
});

describe("matchStockRows", () => {
  it("empareja por internal_code y calcula next = current + add", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 3 }], products);
    expect(r.rows).toEqual([{ id: "p1", name: "Ficus", internal_code: "001-ABC", current: 5, add: 3, next: 8 }]);
    expect(r.unknown).toEqual([]);
  });
  it("suma cantidades de filas con el mismo código", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 3 }, { codigo: "001-ABC", cantidad: 2 }], products);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].add).toBe(5);
    expect(r.rows[0].next).toBe(10);
  });
  it("ignora cantidades <= 0 y códigos vacíos", () => {
    const r = matchStockRows([{ codigo: "001-ABC", cantidad: 0 }, { codigo: "", cantidad: 5 }], products);
    expect(r.rows).toEqual([]);
    expect(r.unknown).toEqual([]);
  });
  it("reporta códigos desconocidos sin duplicar y no matchea internal_code null", () => {
    const r = matchStockRows([{ codigo: "NOPE", cantidad: 1 }, { codigo: "NOPE", cantidad: 2 }], products);
    expect(r.rows).toEqual([]);
    expect(r.unknown).toEqual(["NOPE"]);
  });
});
