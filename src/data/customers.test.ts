import { describe, it, expect } from "vitest";
import { filterCustomers } from "./customers";

describe("filterCustomers", () => {
  it("filtra por nombre/teléfono (case-insensitive)", () => {
    const rows = [{ id: "1", name: "Camila Rojas", phone: "+56 9 5512", email: "", points: 0, spent: 0, visits: 0 }];
    expect(filterCustomers(rows as any, "camila")).toHaveLength(1);
    expect(filterCustomers(rows as any, "5512")).toHaveLength(1);
    expect(filterCustomers(rows as any, "zzz")).toHaveLength(0);
  });
});
