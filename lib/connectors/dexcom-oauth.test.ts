import { describe, it, expect, vi } from "vitest";
import { buildAuthorizeUrl, tokenExpiryFrom, exchangeCode, refresh } from "@/lib/connectors/dexcom-oauth";
import type { DexcomEnv } from "@/lib/connectors/dexcom-env";

const env: DexcomEnv = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/sources/dexcom/callback",
  apiBase: "https://sandbox-api.dexcom.com",
};

describe("buildAuthorizeUrl", () => {
  it("builds the consent URL with offline_access scope and the state", () => {
    const url = new URL(buildAuthorizeUrl(env, "state-123"));
    expect(url.origin + url.pathname).toBe("https://sandbox-api.dexcom.com/v2/oauth2/login");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(env.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("state")).toBe("state-123");
  });
});

describe("tokenExpiryFrom", () => {
  it("adds expires_in seconds to now and returns ISO", () => {
    const now = new Date("2026-06-03T00:00:00.000Z");
    expect(tokenExpiryFrom(3600, now)).toBe("2026-06-03T01:00:00.000Z");
  });
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("exchangeCode", () => {
  it("POSTs the authorization_code grant and maps the token response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 7200, scope: "offline_access" }),
    );
    const creds = await exchangeCode(env, "the-code", new Date("2026-06-03T00:00:00.000Z"), fetchImpl);

    expect(creds).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: "2026-06-03T02:00:00.000Z",
      scope: "offline_access",
      apiBase: "https://sandbox-api.dexcom.com",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sandbox-api.dexcom.com/v2/oauth2/token");
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("secret");
    expect(body.get("redirect_uri")).toBe(env.redirectUri);
  });

  it("throws on a non-ok token response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, false));
    await expect(exchangeCode(env, "bad", new Date(), fetchImpl)).rejects.toThrow(/dexcom token exchange failed/i);
  });
});

describe("refresh", () => {
  it("POSTs the refresh_token grant and maps the rotated tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline_access" }),
    );
    const creds = await refresh(env, "old-rt", new Date("2026-06-03T00:00:00.000Z"), fetchImpl);

    expect(creds.accessToken).toBe("at2");
    expect(creds.refreshToken).toBe("rt2");
    expect(creds.expiresAt).toBe("2026-06-03T01:00:00.000Z");
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
  });
});
