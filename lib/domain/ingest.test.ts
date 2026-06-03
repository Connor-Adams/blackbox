import { describe, it, expect } from "vitest";
import { extractRawMeta, buildRawEventRow, ingestRawEvents, type IngestStore, type RawEventRow as Row } from "@/lib/domain/ingest";
import { payloadHash, rawEventDedupeKey } from "@/lib/domain/dedup";
import type { NormalizedObservation, NormalizedTimelineEvent } from "@/lib/domain/types";

const manualConn = { id: "conn-m", userId: "user-1", sourceType: "manual" as const };
const dexcomConn = { id: "conn-d", userId: "user-1", sourceType: "dexcom" as const };

describe("extractRawMeta", () => {
  it("manual: no source record id, occurredAt from timestamp", () => {
    const meta = extractRawMeta("manual", { type: "note", title: "x", timestamp: "2026-06-01T09:00:00Z" });
    expect(meta.sourceRecordId).toBeNull();
    expect(meta.occurredAt.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });
  it("dexcom: source record id from recordId, occurredAt from timestamp", () => {
    const meta = extractRawMeta("dexcom", { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z", recordId: "r9" });
    expect(meta.sourceRecordId).toBe("r9");
    expect(meta.occurredAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });
  it("dexcom without recordId: null source record id", () => {
    const meta = extractRawMeta("dexcom", { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z" });
    expect(meta.sourceRecordId).toBeNull();
  });
  it("throws for a source type ingest does not support", () => {
    expect(() => extractRawMeta("garmin", {})).toThrow();
  });
});

describe("buildRawEventRow", () => {
  it("builds a raw_event row with hash + extracted meta", () => {
    const payload = { type: "meal", title: "Lunch", timestamp: "2026-06-01T12:00:00Z" };
    const row = buildRawEventRow(manualConn, payload);
    expect(row.sourceConnectionId).toBe("conn-m");
    expect(row.sourceType).toBe("manual");
    expect(row.sourceRecordId).toBeNull();
    expect(row.importBatchId).toBeNull();
    expect(row.occurredAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
    expect(row.payload).toBe(payload);
    expect(row.payloadHash).toBe(payloadHash(payload));
  });
  it("carries the dexcom source record id", () => {
    const row = buildRawEventRow(dexcomConn, { value: 7, unit: "mmol/L", timestamp: "2026-06-01T12:00:00Z", recordId: "r1" });
    expect(row.sourceRecordId).toBe("r1");
  });
});

/** In-memory IngestStore: dedupes raw events by their natural key, mirroring
 *  the DB's partial unique indexes, so we can test pipeline idempotency DB-free. */
function makeMemoryStore() {
  const rawByKey = new Map<string, { id: string; row: Row }>();
  const observations = new Map<string, NormalizedObservation>();
  const timelineEvents = new Map<string, NormalizedTimelineEvent>();
  let seq = 0;
  const store: IngestStore = {
    async upsertRawEvent(row) {
      const key = rawEventDedupeKey({
        sourceConnectionId: row.sourceConnectionId,
        sourceRecordId: row.sourceRecordId,
        payloadHash: row.payloadHash,
      });
      const existing = rawByKey.get(key);
      if (existing) return { id: existing.id, created: false };
      const id = `raw-${++seq}`;
      rawByKey.set(key, { id, row });
      return { id, created: true };
    },
    async upsertObservation(obs) {
      observations.set(`${obs.rawEventId}|${obs.metric}`, obs);
    },
    async upsertTimelineEvent(ev) {
      timelineEvents.set(`${ev.rawEventId}`, ev);
    },
  };
  return { store, rawByKey, observations, timelineEvents };
}

describe("ingestRawEvents", () => {
  const dexcomConn = { id: "conn-d", userId: "user-1", sourceType: "dexcom" as const };
  const payloads = [
    { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z", recordId: "r1" },
    { value: 7.1, unit: "mmol/L", timestamp: "2026-06-01T10:05:00Z", recordId: "r2" },
  ];

  it("persists raw events and their normalized observations with attribution", async () => {
    const { store, rawByKey, observations } = makeMemoryStore();
    const result = await ingestRawEvents(store, dexcomConn, payloads);
    expect(result).toEqual({ found: 2, created: 2, observations: 2, timelineEvents: 0 });
    expect(rawByKey.size).toBe(2);
    expect(observations.size).toBe(2);
    const obs = [...observations.values()];
    expect(obs.every((o) => o.metric === "glucose" && o.userId === "user-1")).toBe(true);
    expect(obs.every((o) => o.rawEventId.startsWith("raw-"))).toBe(true);
  });

  it("is idempotent: re-ingesting the same payloads creates no duplicates", async () => {
    const { store, rawByKey, observations } = makeMemoryStore();
    await ingestRawEvents(store, dexcomConn, payloads);
    const second = await ingestRawEvents(store, dexcomConn, payloads);
    expect(second.created).toBe(0);
    expect(rawByKey.size).toBe(2);
    expect(observations.size).toBe(2);
  });
});
