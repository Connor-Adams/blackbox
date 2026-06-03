import { describe, it, expect } from "vitest";
import { CONNECTABLE, dexcomConnectAvailable } from "@/lib/connectors/connectable";
import { LIVE_DEXCOM_CONNECTION_ID } from "@/lib/constants";

describe("CONNECTABLE", () => {
  it("maps dexcom to its connect start url", () => {
    expect(CONNECTABLE.dexcom.authStartUrl).toBe("/api/sources/dexcom/connect");
  });
});

describe("dexcomConnectAvailable", () => {
  it("is true when live and no live connection exists yet", () => {
    expect(dexcomConnectAvailable(true, [{ id: "other" }])).toBe(true);
  });
  it("is false when not live", () => {
    expect(dexcomConnectAvailable(false, [])).toBe(false);
  });
  it("is false when the live connection already exists", () => {
    expect(dexcomConnectAvailable(true, [{ id: LIVE_DEXCOM_CONNECTION_ID }])).toBe(false);
  });
});
