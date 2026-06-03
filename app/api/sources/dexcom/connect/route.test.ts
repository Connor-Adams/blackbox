import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/sources/dexcom/connect/route";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.DEXCOM_CLIENT_ID = "cid";
  process.env.DEXCOM_CLIENT_SECRET = "secret";
  process.env.DEXCOM_REDIRECT_URI = "http://localhost:3000/api/sources/dexcom/callback";
  process.env.DEXCOM_API_BASE = "https://sandbox-api.dexcom.com";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("GET /api/sources/dexcom/connect", () => {
  it("redirects to the Dexcom consent URL and sets a state cookie", async () => {
    const res = await GET(new Request("http://localhost:3000/api/sources/dexcom/connect"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://sandbox-api.dexcom.com/v2/oauth2/login");
    const state = loc.searchParams.get("state");
    expect(state).toBeTruthy();
    const cookie = res.cookies.get("dexcom_oauth_state");
    expect(cookie?.value).toBe(state);
  });

  it("redirects back to /sources with an error when not configured", async () => {
    process.env.DEXCOM_CLIENT_ID = "";
    const res = await GET(new Request("http://localhost:3000/api/sources/dexcom/connect"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/sources");
    expect(loc.searchParams.get("dexcom_error")).toBe("not_configured");
  });
});
