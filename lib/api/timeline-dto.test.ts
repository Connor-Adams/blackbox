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
});
