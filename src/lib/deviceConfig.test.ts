import { describe, it, expect, beforeEach } from "vitest";
import { getSkipPrint, setSkipPrint } from "./deviceConfig";

describe("deviceConfig skipPrint", () => {
  beforeEach(() => localStorage.clear());
  it("por defecto es false", () => { expect(getSkipPrint()).toBe(false); });
  it("round-trip true/false", () => {
    setSkipPrint(true); expect(getSkipPrint()).toBe(true);
    setSkipPrint(false); expect(getSkipPrint()).toBe(false);
  });
  it("valor corrupto se lee como false", () => {
    localStorage.setItem("kromi.skipPrint", "sí"); expect(getSkipPrint()).toBe(false);
  });
});
