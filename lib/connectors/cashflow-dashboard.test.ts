import { describe, it, expect, vi } from "vitest";
import { getCashflowDashboard } from "@/lib/connectors/cashflow-dashboard";

function body(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
}

describe("getCashflowDashboard", () => {
  it("returns each section, with null for any that fail (no throw)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/summary")) return body({ currency: "CAD", netWorth: 1, liquidCash: 1, monthlyBurn: 1, monthlyIncome: 1, monthlySavingsRate: 0.1, runwayMonths: 1 });
      if (u.includes("/accounts")) return body("err", 500);
      if (u.includes("/cashflow/monthly")) return body({ months: [] });
      if (u.includes("/by-category")) return body({ categories: [] });
      return body("?", 404);
    }) as unknown as typeof fetch;
    const dash = await getCashflowDashboard({ baseUrl: "https://api.test", token: "t", fetchImpl });
    expect(dash.summary).not.toBeNull();
    expect(dash.accounts).toBeNull();
    expect(dash.monthly).toEqual({ months: [] });
    expect(dash.byCategory).toEqual({ categories: [] });
  });
  it("returns all-null when base/token are missing", async () => {
    const dash = await getCashflowDashboard({ baseUrl: undefined, token: undefined });
    expect(dash).toEqual({ summary: null, accounts: null, monthly: null, byCategory: null });
  });
});
