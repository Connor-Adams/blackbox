import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/domain/normalize";
import { computeInsights, type InsightObservation, type InsightEvent } from "@/lib/domain/insights";
import type { RawEventInput } from "@/lib/domain/types";
import type { SourceType } from "@/lib/db/schema";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay, cashflowDay } from "@/lib/mock/data";

function raw(idx: number, sourceType: SourceType, payload: unknown): RawEventInput {
  return {
    id: `raw-${idx}`,
    userId: "user-1",
    sourceConnectionId: "conn",
    sourceType,
    sourceRecordId: null,
    occurredAt: new Date("2026-06-01T00:00:00Z"),
    payload,
  };
}

describe("v0 acceptance: seeded day yields >= 5 insights", () => {
  it("normalizes the full seed and computes at least 5 distinct insight types", () => {
    const inputs: RawEventInput[] = [
      ...glucoseNormalDay.map((p, i) => raw(i, "dexcom", p)),
      ...glucoseVolatileDay.map((p, i) => raw(100 + i, "dexcom", p)),
      ...manualNotesDay.map((p, i) => raw(200 + i, "manual", p)),
      ...cashflowDay.map((p, i) => raw(300 + i, "cashflow", p)),
    ];

    const observations: InsightObservation[] = [];
    const timelineEvents: InsightEvent[] = [];
    for (const input of inputs) {
      const n = normalize(input);
      n.observations.forEach((o, j) =>
        observations.push({ id: `${input.id}-o${j}`, metric: o.metric, value: o.value, observedAt: o.observedAt }),
      );
      n.timelineEvents.forEach((e, j) =>
        timelineEvents.push({ id: `${input.id}-e${j}`, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata }),
      );
    }

    const types = new Set(computeInsights({ observations, timelineEvents }).map((i) => i.insightType));
    expect(types.size).toBeGreaterThanOrEqual(5);
    for (const t of ["glucose_volatility", "glucose_high", "glucose_low", "spike_without_context", "high_spend"]) {
      expect(types.has(t)).toBe(true);
    }
  });
});
