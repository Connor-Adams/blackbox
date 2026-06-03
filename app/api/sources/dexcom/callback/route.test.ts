import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connectors/dexcom-oauth", () => ({ exchangeCode: vi.fn() }));
vi.mock("@/lib/db/sources", () => ({ upsertLiveDexcomConnection: vi.fn(async () => "live-id") }));

import { GET } from "@/app/api/sources/dexcom/callback/route";
import { exchangeCode } from "@/lib/connectors/dexcom-oauth";
import { upsertLiveDexcomConnection } from "@/lib/db/sources";

function req(query: string, cookie?: string) {
  return new Request(`http://localhost:3000/api/sources/dexcom/callback${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

function errorOf(res: Response) {
  return new URL(res.headers.get("location")!).searchParams;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/sources/dexcom/callback", () => {
  it("redirects bad_state when the state param is missing", async () => {
    const res = await GET(req("?code=abc"));
    expect(errorOf(res).get("dexcom_error")).toBe("bad_state");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("redirects bad_state when state does not match the cookie", async () => {
    const res = await GET(req("?code=abc&state=x", "dexcom_oauth_state=y"));
    expect(errorOf(res).get("dexcom_error")).toBe("bad_state");
  });

  it("ignores a cookie whose name only suffix-matches the state cookie", async () => {
    const res = await GET(req("?code=abc&state=val", "evil_dexcom_oauth_state=val"));
    expect(errorOf(res).get("dexcom_error")).toBe("bad_state");
  });

  it("redirects exchange_failed when the token exchange throws", async () => {
    vi.mocked(exchangeCode).mockRejectedValueOnce(new Error("nope"));
    const res = await GET(req("?code=abc&state=s", "dexcom_oauth_state=s"));
    expect(errorOf(res).get("dexcom_error")).toBe("exchange_failed");
  });

  it("exchanges, upserts, clears the cookie, and redirects connected on success", async () => {
    vi.mocked(exchangeCode).mockResolvedValueOnce({
      accessToken: "a", refreshToken: "r", expiresAt: "x", scope: "s", apiBase: "b",
    });
    const res = await GET(req("?code=abc&state=s", "dexcom_oauth_state=s"));
    expect(upsertLiveDexcomConnection).toHaveBeenCalledTimes(1);
    expect(errorOf(res).get("dexcom")).toBe("connected");
    expect(res.cookies.get("dexcom_oauth_state")?.value).toBe("");
  });

  it("builds the redirect against the forwarded host (proxy), not the internal request url", async () => {
    delete process.env.BLACKBOX_APP_URL;
    const res = await GET(
      new Request("http://localhost:8080/api/sources/dexcom/callback?code=abc&state=s", {
        headers: {
          cookie: "dexcom_oauth_state=mismatch",
          "x-forwarded-host": "blackbox-production-d439.up.railway.app",
          "x-forwarded-proto": "https",
        },
      }),
    );
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://blackbox-production-d439.up.railway.app");
    expect(loc.pathname).toBe("/sources");
  });
});
