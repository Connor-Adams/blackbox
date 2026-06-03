import { describe, it, expect } from "vitest";
import { serializeSources } from "@/lib/api/source-dto";

const row = (over: Partial<Record<string, unknown>>) => ({
  id: "c1", userId: "u", sourceType: "dexcom", displayName: "Dexcom (mock)", status: "active",
  createdAt: new Date(), updatedAt: new Date(), lastSyncAt: new Date("2026-06-01T10:00:00Z"), metadata: {}, ...over,
});

describe("serializeSources", () => {
  it("maps rows to id/sourceType/displayName/status/lastSyncAt(ISO|null)", () => {
    const out = serializeSources([row({}), row({ id: "c2", lastSyncAt: null })] as never);
    expect(out[0]).toEqual({ id: "c1", sourceType: "dexcom", displayName: "Dexcom (mock)", status: "active", lastSyncAt: "2026-06-01T10:00:00.000Z" });
    expect(out[1].lastSyncAt).toBeNull();
  });
});
