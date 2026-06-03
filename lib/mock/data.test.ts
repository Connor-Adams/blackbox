import { describe, it, expect } from "vitest";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";
import { cashflowDay } from "@/lib/mock/data";

describe("mock data", () => {
  it("normal glucose day is a non-empty series of mmol/L readings with ids", () => {
    expect(glucoseNormalDay.length).toBeGreaterThan(0);
    expect(glucoseNormalDay.every((r) => r.unit === "mmol/L" && typeof r.value === "number" && r.recordId)).toBe(true);
  });
  it("volatile glucose day swings wider than the normal day", () => {
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(range(glucoseVolatileDay.map((r) => r.value))).toBeGreaterThan(range(glucoseNormalDay.map((r) => r.value)));
  });
  it("manual notes day has meal/insulin/stress annotations", () => {
    const types = manualNotesDay.map((a) => a.type);
    expect(types).toContain("meal");
    expect(types).toContain("insulin");
    expect(types).toContain("stress");
  });
});

describe("cashflow mock", () => {
  it("is transactions whose total exceeds the high-spend threshold (200)", () => {
    expect(cashflowDay.length).toBeGreaterThan(0);
    expect(cashflowDay.every((t) => typeof t.amount === "number" && t.recordId && t.description)).toBe(true);
    expect(cashflowDay.reduce((a, b) => a + b.amount, 0)).toBeGreaterThan(200);
  });
});
