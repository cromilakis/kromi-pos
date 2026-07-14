import { describe, expect, it } from "vitest";
import { businessToNegocio, type BusinessRow } from "./business";

const base: BusinessRow = {
  id: "b1",
  name: "Vivero Kromi SpA",
  nombre_comercial: "Kromi",
  rut: "76.123.456-7",
  giro: "Venta de plantas",
  direccion: "Av. Siempreviva 742",
  tagline: "Tu jardín, nuestro oficio",
  footer: "¡Gracias por su compra!",
  logo_url: null,
  social_red: "Instagram",
  social_url: "https://instagram.com/kromi",
  points_clp_per_point: 1000,
  points_multiplier: 1,
  points_redeem_clp_per_point: 1,
  lock_timeout_min: 0,
};

describe("businessToNegocio", () => {
  it("mapea los campos del negocio al payload ESC/POS", () => {
    const n = businessToNegocio(base, "GEZHI 80mm");
    expect(n.razon_social).toBe("Vivero Kromi SpA");
    expect(n.rut).toBe("76.123.456-7");
    expect(n.giro).toBe("Venta de plantas");
    expect(n.direccion).toBe("Av. Siempreviva 742");
    expect(n.footer).toBe("¡Gracias por su compra!");
    expect(n.printer_name).toBe("GEZHI 80mm");
    expect(n.social).toEqual({ red: "Instagram", url: "https://instagram.com/kromi", etiqueta: "@Instagram" });
  });

  it("usa social null cuando falta red o url", () => {
    expect(businessToNegocio({ ...base, social_url: null }, "").social).toBeNull();
    expect(businessToNegocio({ ...base, social_red: null }, "").social).toBeNull();
  });

  it("convierte nulos en cadenas vacías y tolera business undefined", () => {
    const n = businessToNegocio({ ...base, giro: null, direccion: null, tagline: null, footer: null }, "");
    expect(n.giro).toBe("");
    expect(n.direccion).toBe("");
    expect(n.footer).toBe("");

    const empty = businessToNegocio(undefined, "P1");
    expect(empty.razon_social).toBe("");
    expect(empty.rut).toBe("");
    expect(empty.printer_name).toBe("P1");
    expect(empty.social).toBeNull();
  });
});
