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
    const raw: RawEventInput = { ...base, sourceType: "garmin", payload: {} };
    expect(normalize(raw)).toEqual({ observations: [], timelineEvents: [] });
  });
});
