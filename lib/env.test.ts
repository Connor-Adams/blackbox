import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("accepts a valid postgres DATABASE_URL and defaults the app url", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host:5432/blackbox",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@host:5432/blackbox");
    expect(env.BLACKBOX_APP_URL).toBe("http://localhost:3000");
  });

  it("respects an explicit BLACKBOX_APP_URL", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@host:5432/blackbox",
      BLACKBOX_APP_URL: "https://blackbox.up.railway.app",
    });
    expect(env.BLACKBOX_APP_URL).toBe("https://blackbox.up.railway.app");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseEnv({})).toThrow();
  });

  it("throws when DATABASE_URL is not a URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrow();
  });
});
