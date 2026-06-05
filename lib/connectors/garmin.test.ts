import { describe, it, expect, vi } from "vitest";
import { garminConnector } from "@/lib/connectors/garmin";
import type { ConnectorSyncContext, SyncConnection } from "@/lib/connectors/types";
import { garminMockDay } from "@/lib/mock/garmin";

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
