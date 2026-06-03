import { describe, it, expect } from "vitest";
import { payloadHash, stableStringify, rawEventDedupeKey } from "@/lib/domain/dedup";

describe("stableStringify", () => {
  it("is order-independent for object keys", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it("distinguishes different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("payloadHash", () => {
  it("is deterministic regardless of key order", () => {
    expect(payloadHash({ x: 1, y: [2, 3] })).toBe(payloadHash({ y: [2, 3], x: 1 }));
  });
  it("changes when the payload changes", () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }));
  });
});

describe("rawEventDedupeKey", () => {
  it("keys on sourceRecordId when present", () => {
    expect(rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h1" })).toBe("c1:id:r1");
  });
  it("falls back to payloadHash when sourceRecordId is null", () => {
    expect(rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: null, payloadHash: "h1" })).toBe("c1:hash:h1");
  });
  it("is stable for the same inputs (idempotent imports map to the same key)", () => {
    const a = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h1" });
    const b = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h2" });
    expect(a).toBe(b);
  });
});
