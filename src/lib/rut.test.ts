import { describe, it, expect } from "vitest";
import { normRut, rutToEmail } from "./rut";

describe("normRut", () => {
  it("quita puntos y guion y pasa a minúscula", () => {
    expect(normRut("11.111.111-1")).toBe("111111111");
    expect(normRut("19.608.320-0")).toBe("196083200");
    expect(normRut("12.345.678-K")).toBe("12345678k");
  });
  it("tolera espacios", () => {
    expect(normRut(" 11.111.111-1 ")).toBe("111111111");
  });
});

describe("rutToEmail", () => {
  it("construye el email sintético", () => {
    expect(rutToEmail("19.608.320-0")).toBe("196083200@pos.kromi.local");
  });
});
