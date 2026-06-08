import { describe, it, expect, vi } from "vitest";
import { garminConnector } from "@/lib/connectors/garmin";
import type { ConnectorSyncContext, SyncConnection } from "@/lib/connectors/types";
import { garminMockDay } from "@/lib/mock/garmin";
import { syncDates } from "@/lib/connectors/garmin-api";

function ctxFor(connection: Partial<SyncConnection>, now: Date): ConnectorSyncContext {
  return {
    connection: { id: "c", userId: "u", sourceType: "garmin", metadata: {}, lastSyncAt: null, ...connection },
    now,
    saveCredentials: vi.fn(async () => {}),
  };
}

describe("garminConnector (mock branch)", () => {
  it("emits the mock day when the connection has no garmin creds", async () => {
    const out = await garminConnector.sync(ctxFor({ metadata: {} }, new Date("2026-06-02T00:00:00Z")));
    expect(out).toEqual(garminMockDay);
    expect(out[0]).toHaveProperty("kind", "observation");
  });
});

describe("syncDates", () => {
  it("initial sync = inclusive last-7-days window (8 dates)", () => {
    expect(syncDates(null, new Date("2026-06-08T12:00:00Z"))).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
      "2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08",
    ]);
  });
  it("incremental from lastSyncAt forward", () => {
    expect(syncDates(new Date("2026-06-07T00:00:00Z"), new Date("2026-06-08T12:00:00Z"))).toEqual([
      "2026-06-07", "2026-06-08",
    ]);
  });
  it("returns [] when lastSyncAt is ahead of now (clock skew)", () => {
    expect(syncDates(new Date("2026-06-09T00:00:00Z"), new Date("2026-06-08T00:00:00Z"))).toEqual([]);
  });
});
