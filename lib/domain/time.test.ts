import { describe, it, expect } from "vitest";
import { dayRange } from "@/lib/domain/time";

describe("dayRange", () => {
  it("returns the [start, end) UTC instants for a calendar date", () => {
    const { start, end } = dayRange("2026-06-01");
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });
  it("end is exactly 24h after start", () => {
    const { start, end } = dayRange("2026-12-31");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
  it("throws on a malformed date", () => {
    expect(() => dayRange("2026-6-1")).toThrow();
    expect(() => dayRange("not-a-date")).toThrow();
  });
});
