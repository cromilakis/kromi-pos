import { describe, it, expect } from "vitest";
import { filterInvoices, type InvoiceFilters } from "./invoiceFilters";

const EMPTY: InvoiceFilters = { supplierId: "", from: "", to: "", min: "", max: "", text: "" };
const inv = [
  { supplier_id: "s1", folio: "100", issued_at: "2026-07-01", total: 1000, supplierName: "Floriterra" },
  { supplier_id: "s2", folio: "205", issued_at: "2026-07-10", total: 5000, supplierName: "Vivero Sur" },
  { supplier_id: "s1", folio: "300", issued_at: null, total: 3000, supplierName: "Floriterra" },
];

describe("filterInvoices", () => {
  it("sin filtros devuelve todo", () => {
    expect(filterInvoices(inv, EMPTY)).toHaveLength(3);
  });
  it("filtra por proveedor", () => {
    expect(filterInvoices(inv, { ...EMPTY, supplierId: "s2" }).map((i) => i.folio)).toEqual(["205"]);
  });
  it("filtra por rango de fechas (excluye sin fecha si hay límite)", () => {
    const r = filterInvoices(inv, { ...EMPTY, from: "2026-07-05", to: "2026-07-31" });
    expect(r.map((i) => i.folio)).toEqual(["205"]);
  });
  it("filtra por rango de monto", () => {
    expect(filterInvoices(inv, { ...EMPTY, min: "2000", max: "4000" }).map((i) => i.folio)).toEqual(["300"]);
  });
  it("busca por folio o razón social (case-insensitive)", () => {
    expect(filterInvoices(inv, { ...EMPTY, text: "vivero" }).map((i) => i.folio)).toEqual(["205"]);
    expect(filterInvoices(inv, { ...EMPTY, text: "300" }).map((i) => i.folio)).toEqual(["300"]);
  });
  it("combina filtros", () => {
    expect(filterInvoices(inv, { ...EMPTY, supplierId: "s1", max: "1500" }).map((i) => i.folio)).toEqual(["100"]);
  });
});
