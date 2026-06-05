import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/domain/normalize";
import type { RawEventInput } from "@/lib/domain/types";

const base = {
  id: "raw-1",
  userId: "user-1",
  sourceConnectionId: "conn-1",
  sourceRecordId: null,
  occurredAt: new Date("2026-06-01T12:00:00Z"),
} as const;

describe("normalize: manual", () => {
  it("maps a manual meal annotation to a timeline event with attribution", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "meal", title: "Lunch", timestamp: "2026-06-01T12:30:00Z", notes: "pasta" },
    };
    const { observations, timelineEvents } = normalize(raw);
    expect(observations).toEqual([]);
    expect(timelineEvents).toHaveLength(1);
    const ev = timelineEvents[0];
    expect(ev.eventType).toBe("meal");
    expect(ev.sourceType).toBe("manual");
    expect(ev.rawEventId).toBe("raw-1");
    expect(ev.userId).toBe("user-1");
    expect(ev.title).toBe("Lunch");
    expect(ev.description).toBe("pasta");
    expect(ev.startedAt.toISOString()).toBe("2026-06-01T12:30:00.000Z");
    expect(ev.endedAt).toBeNull();
    expect(ev.metadata.annotationType).toBe("meal");
  });

  it("maps an unknown annotation type to manual_note and records the original type", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "caffeine", title: "Coffee", timestamp: "2026-06-01T08:00:00Z" },
    };
    const ev = normalize(raw).timelineEvents[0];
    expect(ev.eventType).toBe("manual_note");
    expect(ev.metadata.annotationType).toBe("caffeine");
    expect(ev.description).toBeNull();
  });

  it("carries an end timestamp when provided", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "travel", title: "Flight", timestamp: "2026-06-01T06:00:00Z", endTimestamp: "2026-06-01T10:00:00Z" },
    };
    const ev = normalize(raw).timelineEvents[0];
    expect(ev.eventType).toBe("travel");
    expect(ev.endedAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("returns empty for an unsupported source type", () => {
    // Use a cast to simulate an unknown future source type reaching normalize
    const raw = { ...base, sourceType: "unknown_future_type" as "garmin", payload: {} };
    expect(normalize(raw as RawEventInput)).toEqual({ observations: [], timelineEvents: [] });
  });
});

describe("normalize: dexcom", () => {
  const dbase = {
    id: "raw-2",
    userId: "user-1",
    sourceConnectionId: "conn-2",
    sourceRecordId: "reading-99",
    occurredAt: new Date("2026-06-01T12:00:00Z"),
    sourceType: "dexcom" as const,
  };

  it("maps a glucose reading to a glucose observation with attribution", () => {
    const raw: RawEventInput = {
      ...dbase,
      payload: { value: 7.1, unit: "mmol/L", timestamp: "2026-06-01T12:05:00Z", trend: "flat", trendRate: 0.1 },
    };
    const { observations, timelineEvents } = normalize(raw);
    expect(timelineEvents).toEqual([]);
    expect(observations).toHaveLength(1);
    const obs = observations[0];
    expect(obs.metric).toBe("glucose");
    expect(obs.sourceType).toBe("dexcom");
    expect(obs.rawEventId).toBe("raw-2");
    expect(obs.userId).toBe("user-1");
    expect(obs.value).toBe(7.1);
    expect(obs.unit).toBe("mmol/L");
    expect(obs.observedAt.toISOString()).toBe("2026-06-01T12:05:00.000Z");
    expect(obs.metadata).toEqual({ trend: "flat", trendRate: 0.1 });
  });

  it("omits trend fields from metadata when absent", () => {
    const raw: RawEventInput = {
      ...dbase,
      payload: { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T13:00:00Z" },
    };
    const obs = normalize(raw).observations[0];
    expect(obs.metadata).toEqual({});
  });
});

describe("normalize: cashflow", () => {
  const cbase = {
    id: "raw-3", userId: "user-1", sourceConnectionId: "conn-3",
    sourceRecordId: "tx-1", occurredAt: new Date("2026-06-01T12:00:00Z"), sourceType: "cashflow" as const,
  };
  it("maps a transaction to a transaction_amount observation AND a transaction timeline event", () => {
    const raw: RawEventInput = { ...cbase, payload: { recordId: "tx-1", amount: 62, description: "Groceries", timestamp: "2026-06-01T12:00:00Z", category: "groceries" } };
    const { observations, timelineEvents } = normalize(raw);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ metric: "transaction_amount", value: 62, unit: "USD", sourceType: "cashflow", rawEventId: "raw-3" });
    expect(observations[0].metadata).toMatchObject({ description: "Groceries", category: "groceries" });
    expect(timelineEvents).toHaveLength(1);
    expect(timelineEvents[0]).toMatchObject({ eventType: "transaction", title: "Groceries", sourceType: "cashflow", rawEventId: "raw-3" });
    expect(timelineEvents[0].startedAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
  });
});

function raw(payload: unknown): RawEventInput {
  return { id: "r1", userId: "u", sourceConnectionId: "c", sourceType: "garmin", sourceRecordId: "x", occurredAt: new Date("2026-06-01T08:00:00Z"), payload };
}

describe("normalize garmin", () => {
  it("maps an observation payload to one observation", () => {
    const out = normalize(raw({ kind: "observation", metric: "heart_rate", value: 61, unit: "bpm", timestamp: "2026-06-01T08:00:00Z", recordId: "heart_rate:1" }));
    expect(out.observations).toEqual([
      { userId: "u", rawEventId: "r1", sourceType: "garmin", metric: "heart_rate", value: 61, unit: "bpm", observedAt: new Date("2026-06-01T08:00:00Z"), metadata: {} },
    ]);
    expect(out.timelineEvents).toEqual([]);
  });

  it("maps an activity payload to a workout timeline event", () => {
    const out = normalize(raw({ kind: "activity", recordId: "a1", activityType: "running", title: "Morning Run", startTimestamp: "2026-06-01T06:00:00Z", endTimestamp: "2026-06-01T06:40:00Z", metadata: { distance: 8000 } }));
    expect(out.observations).toEqual([]);
    expect(out.timelineEvents).toEqual([
      { userId: "u", rawEventId: "r1", sourceType: "garmin", eventType: "workout", title: "Morning Run", description: null, startedAt: new Date("2026-06-01T06:00:00Z"), endedAt: new Date("2026-06-01T06:40:00Z"), metadata: { activityType: "running", distance: 8000 } },
    ]);
  });

  it("maps a sleep payload to a sleep event + sleep_duration observation", () => {
    const out = normalize(raw({ kind: "sleep", recordId: "sleep:2026-06-01", startTimestamp: "2026-05-31T23:00:00Z", endTimestamp: "2026-06-01T07:00:00Z", durationSeconds: 28800, stages: { deep: 7200, rem: 5400 } }));
    expect(out.observations).toHaveLength(1);
    expect(out.observations[0]).toMatchObject({ metric: "sleep_duration", value: 28800, unit: "s", metadata: { deep: 7200, rem: 5400 } });
    expect(out.timelineEvents[0]).toMatchObject({ eventType: "sleep", title: "Sleep", endedAt: new Date("2026-06-01T07:00:00Z") });
  });
});
