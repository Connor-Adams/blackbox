import { describe, it, expect, vi } from "vitest";
import { fetchCashflowTransactions } from "./cashflow-api";
import { cashflowGet, fetchCashflowSummary, fetchCashflowByCategory } from "@/lib/connectors/cashflow-api";

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const BASE_URL = "https://backend-production-30f95.up.railway.app";
const TOKEN = "cfr_test_token";

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Unauthorized",
    json: async () => body,
  } as unknown as Response;
}

describe("fetchCashflowTransactions", () => {
  it("fetches a single page and maps transactions (negating amounts)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      makeResponse({
        transactions: [
          { id: 101, date: "2026-05-01", merchant: "Starbucks", amount: -5.5, category: "dining" },
        ],
        // no nextCursor
      }),
    );

    const result = await fetchCashflowTransactions(BASE_URL, TOKEN, { start: "2026-05-01", end: "2026-05-31" }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("101");
    expect(result[0].amount).toBe(5.5); // negated
    expect(result[0].description).toBe("Starbucks");
    expect(result[0].category).toBe("dining");
    expect(result[0].timestamp).toBe("2026-05-01T12:00:00Z");
  });

  it("paginates: follows nextCursor until exhausted, accumulating all payloads", async () => {
    const capturedUrls: string[] = [];
    const capturedHeaders: string[] = [];

    const fetchImpl = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      capturedUrls.push(url);
      capturedHeaders.push((init.headers as Record<string, string>)["Authorization"]);

      if (capturedUrls.length === 1) {
        return Promise.resolve(
          makeResponse({
            transactions: [{ id: 1, date: "2026-05-01", merchant: "Shop A", amount: -10 }],
            nextCursor: "c2",
          }),
        );
      } else {
        return Promise.resolve(
          makeResponse({
            transactions: [{ id: 2, date: "2026-05-02", merchant: "Shop B", amount: -20 }],
            // no nextCursor — stop
          }),
        );
      }
    });

    const result = await fetchCashflowTransactions(BASE_URL, TOKEN, { start: "2026-05-01", end: "2026-05-31" }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);

    // First page: no cursor param
    const url1 = new URL(capturedUrls[0]);
    expect(url1.searchParams.get("cursor")).toBeNull();
    expect(url1.searchParams.get("start")).toBe("2026-05-01");
    expect(url1.searchParams.get("end")).toBe("2026-05-31");
    expect(url1.searchParams.get("limit")).toBe("200");

    // Second page: cursor=c2 present
    const url2 = new URL(capturedUrls[1]);
    expect(url2.searchParams.get("cursor")).toBe("c2");

    // Both pages send Authorization header
    expect(capturedHeaders[0]).toBe(`Bearer ${TOKEN}`);
    expect(capturedHeaders[1]).toBe(`Bearer ${TOKEN}`);

    // Amounts correctly negated
    expect(result[0].amount).toBe(10);
    expect(result[1].amount).toBe(20);
  });

  it("throws when the API returns a non-200 status", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(makeResponse({}, false, 401));

    await expect(
      fetchCashflowTransactions(BASE_URL, TOKEN, { start: "2026-05-01", end: "2026-05-31" }, fetchImpl),
    ).rejects.toThrow("cashflow API 401");
  });
});

describe("cashflowGet", () => {
  it("sends the bearer token and returns the parsed body", async () => {
    const f = okFetch({ hello: "world" });
    const out = await cashflowGet<{ hello: string }>("https://api.test", "cfr_x", "/api/v1/summary", f);
    expect(out).toEqual({ hello: "world" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("https://api.test/api/v1/summary");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer cfr_x" });
  });
  it("throws on a non-2xx response", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(cashflowGet("https://api.test", "t", "/api/v1/summary", f)).rejects.toThrow(/401/);
  });
});

describe("aggregate fetchers", () => {
  it("fetchCashflowSummary returns the summary body", async () => {
    const summary = { currency: "CAD", netWorth: 1000, liquidCash: 200, monthlyBurn: 50, monthlyIncome: 80, monthlySavingsRate: 0.3, runwayMonths: 4 };
    expect(await fetchCashflowSummary("https://api.test", "t", okFetch(summary))).toEqual(summary);
  });
  it("fetchCashflowByCategory passes start/end and returns categories", async () => {
    const f = okFetch({ categories: [{ name: "dining", amount: 100, percentage: 50, transactionCount: 3, trendVsPreviousPeriod: 0.1 }] });
    const out = await fetchCashflowByCategory("https://api.test", "t", { start: "2026-03-01", end: "2026-06-01" }, f);
    expect(out.categories[0].name).toBe("dining");
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("/api/v1/spending/by-category?start=2026-03-01&end=2026-06-01");
  });
});
