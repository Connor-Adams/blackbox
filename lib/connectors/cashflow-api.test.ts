import { describe, it, expect, vi } from "vitest";
import { fetchCashflowTransactions } from "./cashflow-api";

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
