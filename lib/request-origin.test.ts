import { describe, it, expect, afterEach } from "vitest";
import { publicOrigin } from "@/lib/request-origin";

const ORIGINAL = process.env.BLACKBOX_APP_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BLACKBOX_APP_URL;
  else process.env.BLACKBOX_APP_URL = ORIGINAL;
});

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("publicOrigin", () => {
  it("prefers BLACKBOX_APP_URL over everything else", () => {
    process.env.BLACKBOX_APP_URL = "https://app.example.com";
    const out = publicOrigin(req("http://localhost:8080/x", { "x-forwarded-host": "other.test" }));
    expect(out).toBe("https://app.example.com");
  });

  it("falls back to x-forwarded-host + x-forwarded-proto behind a proxy", () => {
    delete process.env.BLACKBOX_APP_URL;
    const out = publicOrigin(
      req("http://localhost:8080/x", {
        "x-forwarded-host": "blackbox-production-d439.up.railway.app",
        "x-forwarded-proto": "https",
      }),
    );
    expect(out).toBe("https://blackbox-production-d439.up.railway.app");
  });

  it("defaults forwarded proto to https when only the host is present", () => {
    delete process.env.BLACKBOX_APP_URL;
    expect(publicOrigin(req("http://localhost:8080/x", { "x-forwarded-host": "h.test" }))).toBe("https://h.test");
  });

  it("falls back to the request origin when no env or forwarded headers", () => {
    delete process.env.BLACKBOX_APP_URL;
    expect(publicOrigin(req("http://localhost:3000/x"))).toBe("http://localhost:3000");
  });
});
