import { describe, expect, it } from "vitest";
import { PALETTE } from "./categoryColors";

describe("PALETTE", () => {
  it("ofrece una paleta amplia de colores", () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(16);
  });

  it("cada color tiene los cuatro tonos en formato hex válido", () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const c of PALETTE) {
      expect(c.dot).toMatch(hex);
      expect(c.tile).toMatch(hex);
      expect(c.pill_bg).toMatch(hex);
      expect(c.pill_fg).toMatch(hex);
    }
  });

  it("los dots son únicos (sin colores repetidos)", () => {
    const dots = PALETTE.map((c) => c.dot);
    expect(new Set(dots).size).toBe(dots.length);
  });
});
