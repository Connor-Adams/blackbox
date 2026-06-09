import { describe, it, expect } from "vitest";
import { computeTrend, type TrendInput } from "@/lib/domain/trends";

function days(count: number, baseValue: number, stepPerDay = 0): TrendInput["history"] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    value: baseValue + stepPerDay * i,
  }));
}

describe("computeTrend", () => {
  it("returns stable when delta7d < 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.7,
      today: "2026-06-15",
      history: days(14, 6.6),
    });
    expect(result.direction).toBe("stable");
    expect(result.metric).toBe("glucose");
    expect(result.value).toBe(6.7);
  });

  it("returns rising when today > 7d baseline by ≥ 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 7.0,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.direction).toBe("rising");
    expect(result.delta7dPct).toBeGreaterThanOrEqual(3);
  });

  it("returns falling when today < 7d baseline by ≥ 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.0,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.direction).toBe("falling");
    expect(result.delta7dPct).toBeLessThanOrEqual(-3);
  });

  it("computes 7d baseline from last 7 days only", () => {
    const history = [
      ...days(7, 10.0),
      { date: "2026-06-08", value: 6.0 },
      { date: "2026-06-09", value: 6.0 },
      { date: "2026-06-10", value: 6.0 },
      { date: "2026-06-11", value: 6.0 },
      { date: "2026-06-12", value: 6.0 },
      { date: "2026-06-13", value: 6.0 },
      { date: "2026-06-14", value: 6.0 },
    ];
    const result = computeTrend({ metric: "glucose", todayValue: 6.0, today: "2026-06-15", history });
    expect(result.baseline7d).toBe(6.0);
  });

  it("returns null baselines when insufficient samples", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(2, 6.5),
    });
    expect(result.baseline7d).toBeNull();
    expect(result.delta7dPct).toBeNull();
    expect(result.direction).toBe("stable");
  });

  it("computes streak from consecutive same-direction days", () => {
    const history = [
      { date: "2026-06-10", value: 6.0 },
      { date: "2026-06-11", value: 6.0 },
      { date: "2026-06-12", value: 6.5 },
      { date: "2026-06-13", value: 7.0 },
      { date: "2026-06-14", value: 7.5 },
    ];
    const result = computeTrend({ metric: "glucose", todayValue: 8.0, today: "2026-06-15", history });
    expect(result.streak).toBeGreaterThanOrEqual(3);
  });

  it("resets streak to 0 for stable direction", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.streak).toBe(0);
  });

  it("returns correct sampleCounts", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(10, 6.5),
    });
    expect(result.sampleCount7d).toBe(7);
    expect(result.sampleCount30d).toBe(10);
  });
});
