import { describe, it, expect } from "vitest";
import { dayRangeUtc } from "./salesHistory";

describe("dayRangeUtc", () => {
  it("start es 00:00 del from y end es 00:00 del día siguiente al to", () => {
    const { start, end } = dayRangeUtc("2026-07-01", "2026-07-14");
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getDate()).toBe(15); // exclusivo: día siguiente al 'to'
  });
});
