import { describe, it, expect, vi } from "vitest";
import { dexcomDate, egvToPayload, fetchEgvs } from "@/lib/connectors/dexcom-api";

describe("dexcomDate", () => {
  it("formats a Date as YYYY-MM-DDThh:mm:ss in UTC, no zone, no millis", () => {
    expect(dexcomDate(new Date("2026-06-03T04:05:06.789Z"))).toBe("2026-06-03T04:05:06");
  });
});

describe("egvToPayload", () => {
  it("maps a Dexcom v3 EGV record to a DexcomReadingPayload using systemTime as UTC", () => {
    const payload = egvToPayload({
      recordId: "egv-1",
      systemTime: "2026-06-03T08:00:00",
      displayTime: "2026-06-03T01:00:00",
      value: 120,
      unit: "mg/dL",
      trend: "flat",
      trendRate: 0.3,
    });
    expect(payload).toEqual({
      value: 120,
      unit: "mg/dL",
      timestamp: "2026-06-03T08:00:00.000Z",
      trend: "flat",
      trendRate: 0.3,
      recordId: "egv-1",
    });
  });

  it("returns null for records with a null value (Low/High markers)", () => {
    expect(
      egvToPayload({ recordId: "egv-2", systemTime: "2026-06-03T08:05:00", displayTime: "x", value: null, unit: "mg/dL" }),
    ).toBeNull();
  });

  it("omits trendRate when absent", () => {
    const payload = egvToPayload({ recordId: "egv-3", systemTime: "2026-06-03T08:10:00", displayTime: "x", value: 99, unit: "mg/dL", trend: "flat" });
    expect(payload).toEqual({ value: 99, unit: "mg/dL", timestamp: "2026-06-03T08:10:00.000Z", trend: "flat", recordId: "egv-3" });
  });
});

describe("fetchEgvs", () => {
  it("GETs the v3 egvs endpoint with bearer auth and date range, returns records", async () => {
    const records = [{ recordId: "a" }];
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, json: async () => ({ records }), text: async () => "" }) as Response);

    const out = await fetchEgvs("tok", "https://sandbox-api.dexcom.com", "2026-06-01T00:00:00", "2026-06-02T00:00:00", fetchImpl);

    expect(out).toEqual(records);
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe("https://sandbox-api.dexcom.com/v3/users/self/egvs");
    expect(u.searchParams.get("startDate")).toBe("2026-06-01T00:00:00");
    expect(u.searchParams.get("endDate")).toBe("2026-06-02T00:00:00");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "unauthorized" }) as Response);
    await expect(fetchEgvs("tok", "https://x", "a", "b", fetchImpl)).rejects.toThrow(/dexcom egv fetch failed/i);
  });
});
