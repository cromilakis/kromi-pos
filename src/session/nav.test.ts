import { describe, it, expect } from "vitest";
import { navForRole } from "./nav";

describe("navForRole", () => {
  it("cajero: módulos base, sin Administración", () => {
    const labels = navForRole("cajero").map((n) => n.label);
    expect(labels).toEqual(["Inicio", "Venta", "Stock", "Clientes"]);
  });
  it("admin: incluye Administración", () => {
    const labels = navForRole("admin").map((n) => n.label);
    expect(labels).toContain("Administración");
  });
  it("kromi: incluye Administración (super-admin)", () => {
    expect(navForRole("kromi").map((n) => n.label)).toContain("Administración");
  });
});
