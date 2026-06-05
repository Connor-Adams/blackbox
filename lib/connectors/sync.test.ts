import { describe, it, expect, vi } from "vitest";
import { executeSync, type SyncStore } from "@/lib/connectors/sync";
import type { Connector, ConnectorSyncContext, SyncConnection } from "@/lib/connectors/types";

const conn: SyncConnection = {
  id: "conn-1",
  userId: "user-1",
  sourceType: "dexcom",
  metadata: {},
  lastSyncAt: null,
};

function fakeStore(overrides: Partial<SyncStore> = {}): SyncStore {
  return {
    saveCredentials: vi.fn(async () => {}),
    ingest: vi.fn(async () => ({ found: 2, created: 2, observations: 2, timelineEvents: 0 })),
    markSynced: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("executeSync", () => {
  it("runs the connector, ingests payloads, marks synced, and returns the counts", async () => {
    const store = fakeStore();
    const connector: Connector = { sourceType: "dexcom", sync: vi.fn(async () => [{ a: 1 }, { a: 2 }]) };

    const result = await executeSync(store, connector, conn, new Date("2026-06-03T00:00:00Z"));

    expect(result).toEqual({ ok: true, found: 2, created: 2, observations: 2, timelineEvents: 0 });
    expect(store.ingest).toHaveBeenCalledWith(
      { id: "conn-1", userId: "user-1", sourceType: "dexcom" },
      [{ a: 1 }, { a: 2 }],
    );
    expect(store.markSynced).toHaveBeenCalledWith("conn-1");
    expect(store.markError).not.toHaveBeenCalled();
  });

  it("passes a saveCredentials callback bound to the connection id", async () => {
    const store = fakeStore();
    const creds = { accessToken: "a", refreshToken: "r", expiresAt: "x", scope: "s", apiBase: "b" };
    const connector: Connector = {
      sourceType: "dexcom",
      sync: async (ctx: ConnectorSyncContext) => {
        await ctx.saveCredentials(creds);
        return [];
      },
    };

    await executeSync(store, connector, conn, new Date());

    expect(store.saveCredentials).toHaveBeenCalledWith("conn-1", "dexcom", creds);
  });

  it("captures a thrown error: marks error and returns ok:false", async () => {
    const store = fakeStore();
    const connector: Connector = {
      sourceType: "dexcom",
      sync: async () => {
        throw new Error("boom");
      },
    };

    const result = await executeSync(store, connector, conn, new Date());

    expect(result).toEqual({ ok: false, error: "boom" });
    expect(store.markError).toHaveBeenCalledWith("conn-1", "boom");
    expect(store.markSynced).not.toHaveBeenCalled();
  });
});
