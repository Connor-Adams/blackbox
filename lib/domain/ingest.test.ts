import { describe, it, expect } from "vitest";
import { extractRawMeta, buildRawEventRow } from "@/lib/domain/ingest";
import { payloadHash } from "@/lib/domain/dedup";

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
