import { describe, it, expect } from "vitest";
import { isDiscountVigente } from "./discounts";

const D = (over: Partial<{active:boolean;valid_from:string|null;valid_until:string|null}> = {}) =>
  ({ active: true, valid_from: null, valid_until: null, ...over });
const today = new Date("2026-07-14T12:00:00");

describe("isDiscountVigente", () => {
  it("inactivo nunca es vigente", () => expect(isDiscountVigente(D({ active: false }), today)).toBe(false));
  it("activo sin fechas es vigente", () => expect(isDiscountVigente(D(), today)).toBe(true));
  it("dentro del rango es vigente", () => expect(isDiscountVigente(D({ valid_from: "2026-07-01", valid_until: "2026-07-31" }), today)).toBe(true));
  it("antes de valid_from no es vigente", () => expect(isDiscountVigente(D({ valid_from: "2026-08-01" }), today)).toBe(false));
  it("después de valid_until no es vigente", () => expect(isDiscountVigente(D({ valid_until: "2026-07-10" }), today)).toBe(false));
});
