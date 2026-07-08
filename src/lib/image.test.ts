import { describe, expect, it } from "vitest";
import { scaleDimensions } from "./image";

describe("scaleDimensions", () => {
  it("escala al lado mayor manteniendo proporción", () => {
    expect(scaleDimensions(4000, 3000, 200)).toEqual({ w: 200, h: 150 });
    expect(scaleDimensions(1000, 2000, 400)).toEqual({ w: 200, h: 400 });
  });
  it("no amplía imágenes más chicas que el máximo", () => {
    expect(scaleDimensions(150, 100, 200)).toEqual({ w: 150, h: 100 });
  });
});
