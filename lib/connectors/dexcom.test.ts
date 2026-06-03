import { describe, it, expect, vi } from "vitest";
import { dexcomConnector } from "@/lib/connectors/dexcom";
import type { ConnectorSyncContext, DexcomCreds, SyncConnection } from "@/lib/connectors/types";

function ctxFor(connection: Partial<SyncConnection>, now: Date, saveCredentials = vi.fn(async () => {})): ConnectorSyncContext {
  return {
    connection: { id: "c", userId: "u", sourceType: "dexcom", metadata: {}, lastSyncAt: null, ...connection },
    now,
    saveCredentials,
  };
}

function egvResponse(records: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ records }), text: async () => "" } as Response;
}
function tokenResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
}

describe("dexcomConnector (mock branch)", () => {
  it("emits seeded readings when the connection has no credentials", async () => {
    const out = await dexcomConnector.sync(ctxFor({ metadata: {} }, new Date("2026-06-03T00:00:00Z")));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty("value");
    expect(out[0]).toHaveProperty("unit");
  });
});

describe("dexcomConnector (live branch)", () => {
  const future = "2026-06-03T12:00:00.000Z";
  const creds: DexcomCreds = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: future,
    scope: "offline_access",
    apiBase: "https://sandbox-api.dexcom.com",
  };

  it("fetches EGVs with the stored token and maps them to payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      egvResponse([
        { recordId: "e1", systemTime: "2026-06-03T08:00:00", displayTime: "x", value: 110, unit: "mg/dL", trend: "flat" },
        { recordId: "e2", systemTime: "2026-06-03T08:05:00", displayTime: "x", value: null, unit: "mg/dL" },
      ]),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const out = await dexcomConnector.sync(ctxFor({ metadata: { dexcom: creds } }, new Date("2026-06-03T09:00:00Z")));

    expect(out).toEqual([
      { value: 110, unit: "mg/dL", timestamp: "2026-06-03T08:00:00.000Z", trend: "flat", recordId: "e1" },
    ]);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v3/users/self/egvs");
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe("Bearer at");
    vi.unstubAllGlobals();
  });

  it("refreshes and persists rotated creds when the access token is expired", async () => {
    const expired = { ...creds, expiresAt: "2026-06-03T00:00:00.000Z" };
    const save = vi.fn(async () => {});
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline_access" }))
      .mockResolvedValueOnce(egvResponse([{ recordId: "e1", systemTime: "2026-06-03T08:00:00", displayTime: "x", value: 90, unit: "mg/dL" }]));
    vi.stubGlobal("fetch", fetchImpl);

    const out = await dexcomConnector.sync(ctxFor({ metadata: { dexcom: expired } }, new Date("2026-06-03T09:00:00Z"), save));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "at2", refreshToken: "rt2" }));
    expect((fetchImpl.mock.calls[1][1]!.headers as Record<string, string>).Authorization).toBe("Bearer at2");
    expect(out).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
