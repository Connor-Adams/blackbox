import { describe, it, expect } from "vitest";
import { computeCorrelation, CO_FACTOR_DEFS, type DailyPair, type CorrelationConfig } from "@/lib/domain/correlations";

const cfg: CorrelationConfig = {
  primaryMetric: "glucose",
  coFactorMetric: "sleep_duration",
  splitThreshold: 6,
  splitLabel: "6h sleep",
  windowDays: 30,
};

function makePairs(belowCount: number, aboveCount: number, glucoseBelow: number, glucoseAbove: number): DailyPair[] {
  let day = 1;
  const pairs: DailyPair[] = [];
  for (let i = 0; i < belowCount; i++) {
    pairs.push({ date: `2026-06-${String(day++).padStart(2, "0")}`, primaryValue: glucoseBelow, coFactorValue: 5 });
  }
  for (let i = 0; i < aboveCount; i++) {
    pairs.push({ date: `2026-06-${String(day++).padStart(2, "0")}`, primaryValue: glucoseAbove, coFactorValue: 7 });
  }
  return pairs;
}

describe("computeCorrelation", () => {
  it("returns significant when deltaPct ≥ 10% and sampleCount ≥ 14 with ≥ 4 per bucket", () => {
    const pairs = makePairs(8, 8, 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(true);
    expect(result.sampleCount).toBe(16);
    expect(result.primaryWhenBelow).toBe(7.8);
    expect(result.primaryWhenAbove).toBe(6.2);
  });

  it("returns not significant when sampleCount < 14", () => {
    const pairs = makePairs(5, 5, 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("returns not significant when deltaPct < 10%", () => {
    const pairs = makePairs(8, 8, 6.5, 6.3);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("returns not significant when a bucket has < 4 points", () => {
    const pairs = makePairs(2, 12, 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("renders a narrative string", () => {
    const pairs = makePairs(8, 8, 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.narrative).toContain("7.8");
    expect(result.narrative).toContain("6.2");
    expect(result.narrative).toContain("16");
  });

  it("correctly computes deltaPct as absolute percentage difference", () => {
    const pairs = makePairs(8, 8, 7.0, 6.0);
    const result = computeCorrelation(cfg, pairs);
    expect(result.deltaPct).toBeCloseTo(16.7, 0);
  });

  it("CO_FACTOR_DEFS has 8 entries", () => {
    expect(CO_FACTOR_DEFS).toHaveLength(8);
  });

  it("handles empty pairs gracefully", () => {
    const result = computeCorrelation(cfg, []);
    expect(result.significant).toBe(false);
    expect(result.sampleCount).toBe(0);
  });
});
