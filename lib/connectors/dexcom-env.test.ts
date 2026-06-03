import { describe, it, expect } from "vitest";
import { getDexcomEnv, isDexcomLive } from "@/lib/connectors/dexcom-env";

const live = {
  DEXCOM_CLIENT_ID: "cid",
  DEXCOM_CLIENT_SECRET: "secret",
  DEXCOM_REDIRECT_URI: "http://localhost:3000/api/sources/dexcom/callback",
};

describe("getDexcomEnv", () => {
  it("reads client vars and defaults apiBase to the sandbox host", () => {
    expect(getDexcomEnv(live)).toEqual({
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/api/sources/dexcom/callback",
      apiBase: "https://sandbox-api.dexcom.com",
    });
  });

  it("honors an explicit DEXCOM_API_BASE", () => {
    expect(getDexcomEnv({ ...live, DEXCOM_API_BASE: "https://api.dexcom.com" }).apiBase).toBe(
      "https://api.dexcom.com",
    );
  });
});

describe("isDexcomLive", () => {
  it("is true only when all three client vars are present", () => {
    expect(isDexcomLive(live)).toBe(true);
  });
  it("is false when any client var is missing or blank", () => {
    expect(isDexcomLive({ ...live, DEXCOM_CLIENT_SECRET: "" })).toBe(false);
    expect(isDexcomLive({})).toBe(false);
  });
});
