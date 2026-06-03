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
