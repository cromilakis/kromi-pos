import { describe, it, expect, beforeEach } from "vitest";
import { applyAccent } from "./accent";

describe("applyAccent", () => {
  beforeEach(() => document.documentElement.removeAttribute("style"));
  it("setea --accent en :root", () => {
    applyAccent("#123456");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#123456");
  });
  it("ignora valores vacíos (mantiene el actual)", () => {
    applyAccent("#abcdef");
    applyAccent("");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#abcdef");
  });
});
