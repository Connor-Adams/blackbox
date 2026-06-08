import { describe, it, expect } from "vitest";
import { computeInsights } from "@/lib/domain/insights";

const g = (id: string, value: number, iso: string) => ({ id, metric: "glucose", value, observedAt: new Date(iso) });
const ev = (id: string, eventType: string, iso: string) => ({ id, sourceType: "manual", eventType, startedAt: new Date(iso), metadata: {} });

function types(input: Parameters<typeof computeInsights>[0]) {
  return computeInsights(input).map((i) => i.insightType).sort();
}

describe("computeInsights", () => {
  it("returns nothing for a calm in-range day", () => {
    const observations = [g("a", 5.2, "2026-06-01T06:00:00Z"), g("b", 6.1, "2026-06-01T08:00:00Z"), g("c", 5.8, "2026-06-01T10:00:00Z")];
    expect(computeInsights({ observations, timelineEvents: [] })).toEqual([]);
  });

  it("flags volatility, a high, a low, and spike-without-context on a swingy day", () => {
    const observations = [
      g("a", 4.0, "2026-06-01T06:00:00Z"),
      g("b", 13.5, "2026-06-01T09:00:00Z"),
      g("c", 3.2, "2026-06-01T14:00:00Z"),
    ];
    expect(types({ observations, timelineEvents: [] })).toEqual(["glucose_high", "glucose_low", "glucose_volatility", "spike_without_context"]);
  });

  it("suppresses spike_without_context when a meal/insulin is within 90 minutes", () => {
    const observations = [g("a", 5, "2026-06-01T06:00:00Z"), g("b", 13.5, "2026-06-01T09:00:00Z"), g("c", 6, "2026-06-01T10:00:00Z")];
    const timelineEvents = [ev("m", "insulin", "2026-06-01T08:30:00Z")];
    const t = types({ observations, timelineEvents });
    expect(t).toContain("glucose_high");
    expect(t).not.toContain("spike_without_context");
  });

  it("a high glucose insight references the offending reading ids and evidence", () => {
    const observations = [g("a", 5, "2026-06-01T06:00:00Z"), g("hi", 14, "2026-06-01T09:00:00Z")];
    const high = computeInsights({ observations, timelineEvents: [] }).find((i) => i.insightType === "glucose_high")!;
    expect(high.sourceObservationIds).toEqual(["hi"]);
    expect(high.severity).toBe("warning");
    expect(high.evidence.max).toBe(14);
  });

  it("flags a high-spend day from transaction_amount observations", () => {
    const observations = [
      { id: "t1", metric: "transaction_amount", value: 150, observedAt: new Date("2026-06-01T10:00:00Z") },
      { id: "t2", metric: "transaction_amount", value: 120, observedAt: new Date("2026-06-01T12:00:00Z") },
    ];
    expect(types({ observations, timelineEvents: [] })).toContain("high_spend");
  });
});

const o = (id: string, metric: string, value: number, iso = "2026-06-07T08:00:00Z") => ({ id, metric, value, observedAt: new Date(iso) });

describe("computeInsights — garmin recovery rules", () => {
  it("flags low recovery (training readiness < 25)", () => {
    expect(types({ observations: [o("r", "training_readiness", 9)], timelineEvents: [] })).toContain("low_recovery");
  });
  it("flags poor sleep (sleep_score < 50)", () => {
    expect(types({ observations: [o("s", "sleep_score", 42)], timelineEvents: [] })).toContain("poor_sleep");
  });
  it("flags body battery that never recharged (peak < 50)", () => {
    const obs = [o("b1", "body_battery", 5, "2026-06-07T01:00:00Z"), o("b2", "body_battery", 30, "2026-06-07T09:00:00Z")];
    expect(types({ observations: obs, timelineEvents: [] })).toContain("body_battery_low");
  });
  it("flags a high-stress day (avg > 50)", () => {
    const obs = Array.from({ length: 12 }, (_, i) => o(`st${i}`, "stress", 70, `2026-06-07T${String(i).padStart(2, "0")}:00:00Z`));
    expect(types({ observations: obs, timelineEvents: [] })).toContain("high_stress");
  });
  it("flags resting HR elevated vs the trailing baseline", () => {
    const t = types({ observations: [o("rhr", "resting_heart_rate", 65)], timelineEvents: [], baseline: { resting_heart_rate: { mean: 55, stddev: 2, n: 14 } } });
    expect(t).toContain("resting_hr_elevated");
  });
  it("does NOT flag resting HR within the baseline", () => {
    const t = types({ observations: [o("rhr", "resting_heart_rate", 56)], timelineEvents: [], baseline: { resting_heart_rate: { mean: 55, stddev: 2, n: 14 } } });
    expect(t).not.toContain("resting_hr_elevated");
  });
  it("flags recovery_compromised when poor sleep AND low readiness coincide", () => {
    const t = types({ observations: [o("s", "sleep_score", 48), o("r", "training_readiness", 20)], timelineEvents: [] });
    expect(t).toEqual(expect.arrayContaining(["recovery_compromised", "poor_sleep", "low_recovery"]));
  });
  it("returns nothing for a healthy garmin day", () => {
    const obs = [o("s", "sleep_score", 85), o("r", "training_readiness", 75), o("rhr", "resting_heart_rate", 54)];
    expect(computeInsights({ observations: obs, timelineEvents: [], baseline: { resting_heart_rate: { mean: 55, stddev: 2, n: 14 } } })).toEqual([]);
  });
});
