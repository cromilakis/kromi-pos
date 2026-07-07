import { describe, it, expect } from "vitest";
import { mapProfileRow } from "./session";

describe("mapProfileRow", () => {
  it("mapea la fila de app_user a Profile", () => {
    const p = mapProfileRow({ id: "u1", business_id: "b1", name: "Matias", role: "admin", active: true });
    expect(p).toEqual({ id: "u1", business_id: "b1", name: "Matias", role: "admin", active: true });
  });
  it("lanza si el usuario está inactivo", () => {
    expect(() => mapProfileRow({ id: "u1", business_id: "b1", name: "X", role: "cajero", active: false }))
      .toThrow(/inactiv/i);
  });
  it("lanza si no hay fila", () => {
    expect(() => mapProfileRow(null)).toThrow(/perfil/i);
  });
});
