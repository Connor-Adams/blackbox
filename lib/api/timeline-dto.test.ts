import { describe, it, expect } from "vitest";
import { serializeTimeline } from "@/lib/api/timeline-dto";

const ev = (over: Partial<Record<string, unknown>>) => ({
  id: "e", userId: "u", rawEventId: "r", sourceType: "manual", eventType: "manual_note",
  title: "t", description: null, startedAt: new Date("2026-06-01T10:00:00Z"), endedAt: null, metadata: {}, ...over,
});
const obs = (over: Partial<Record<string, unknown>>) => ({
  id: "o", userId: "u", rawEventId: "r", sourceType: "dexcom", metric: "glucose",
  value: 5, unit: "mmol/L", observedAt: new Date("2026-06-01T10:00:00Z"), metadata: {}, ...over,
});

describe("serializeTimeline", () => {
  it("orders events chronologically and serializes dates to ISO", () => {
    const dto = serializeTimeline("2026-06-01", {
      events: [ev({ id: "late", startedAt: new Date("2026-06-01T18:00:00Z") }), ev({ id: "early", startedAt: new Date("2026-06-01T06:00:00Z") })] as never,
      observations: [] as never,
    });
    expect(dto.events.map((e) => e.id)).toEqual(["early", "late"]);
    expect(dto.events[0].startedAt).toBe("2026-06-01T06:00:00.000Z");
    expect(dto.date).toBe("2026-06-01");
  });
  it("keeps only glucose observations, sorted, as {observedAt,value,unit}", () => {
    const dto = serializeTimeline("2026-06-01", {
      events: [] as never,
      observations: [
        obs({ metric: "glucose", value: 7, observedAt: new Date("2026-06-01T12:00:00Z") }),
        obs({ metric: "cash_balance", value: 100 }),
        obs({ metric: "glucose", value: 5, observedAt: new Date("2026-06-01T08:00:00Z") }),
      ] as never,
    });
    expect(dto.glucose.map((g) => g.value)).toEqual([5, 7]);
    expect(dto.glucose[0]).toEqual({ observedAt: "2026-06-01T08:00:00.000Z", value: 5, unit: "mmol/L" });
  });
  it("groups non-glucose, non-finance observations into per-metric series (densest first, sorted points)", () => {
    const dto = serializeTimeline("2026-06-01", {
      events: [] as never,
      observations: [
        obs({ sourceType: "garmin", metric: "heart_rate", value: 60, unit: "bpm", observedAt: new Date("2026-06-01T10:00:00Z") }),
        obs({ sourceType: "garmin", metric: "heart_rate", value: 62, unit: "bpm", observedAt: new Date("2026-06-01T09:00:00Z") }),
        obs({ sourceType: "garmin", metric: "vo2max", value: 37, unit: "ml/kg/min" }),
        obs({ metric: "glucose", value: 5 }), // excluded — surfaced via the glucose field
        obs({ metric: "transaction_amount", value: 10, unit: "USD" }), // excluded — finance lives on /money
      ] as never,
    });
    expect(dto.series.map((s) => s.metric)).toEqual(["heart_rate", "vo2max"]); // densest first
    expect(dto.series[0]).toEqual({
      metric: "heart_rate",
      unit: "bpm",
      points: [
        { observedAt: "2026-06-01T09:00:00.000Z", value: 62 },
        { observedAt: "2026-06-01T10:00:00.000Z", value: 60 },
      ],
    });
    expect(dto.series.some((s) => s.metric === "transaction_amount" || s.metric === "glucose")).toBe(false);
  });
});
