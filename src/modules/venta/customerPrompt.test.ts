import { describe, it, expect } from "vitest";
import { shouldPromptCustomer } from "./customerPrompt";

describe("shouldPromptCustomer", () => {
  it("pide cliente al primer ítem si no hay cliente ni se preguntó", () => {
    expect(shouldPromptCustomer(true, null, false)).toBe(true);
  });
  it("no pide si el carrito ya tenía ítems", () => {
    expect(shouldPromptCustomer(false, null, false)).toBe(false);
  });
  it("no pide si ya hay cliente seleccionado", () => {
    expect(shouldPromptCustomer(true, "c1", false)).toBe(false);
  });
  it("no pide si ya se preguntó en esta venta", () => {
    expect(shouldPromptCustomer(true, null, true)).toBe(false);
  });
});
