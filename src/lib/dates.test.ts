import { describe, expect, it } from "vitest";
import { fmtDateCL } from "./dates";

describe("fmtDateCL", () => {
  it("formatea un date-only (YYYY-MM-DD) sin desfase de zona horaria", () => {
    // El bug: new Date('2026-07-02') se interpreta como medianoche UTC y en Chile
    // (UTC-4/-3) retrocede al 01-07. El helper debe conservar el día tal cual.
    expect(fmtDateCL("2026-07-02")).toBe("02-07-2026");
    expect(fmtDateCL("2026-01-01")).toBe("01-01-2026");
    expect(fmtDateCL("2026-12-31")).toBe("31-12-2026");
  });

  it("devuelve — para valores nulos o inválidos", () => {
    expect(fmtDateCL(null)).toBe("—");
    expect(fmtDateCL("")).toBe("—");
    expect(fmtDateCL("no-es-fecha")).toBe("—");
  });

  it("formatea timestamps completos usando la fecha del instante", () => {
    // Para timestamps con hora sí usamos Date; verificamos el día en formato dd-mm-yyyy.
    expect(fmtDateCL("2026-07-02T15:30:00Z")).toMatch(/^\d{2}-\d{2}-2026$/);
  });
});
