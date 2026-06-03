import type { Connector } from "./types";
import { env } from "@/lib/env";
import { fetchCashflowTransactions } from "./cashflow-api";

const WINDOW_DAYS = 90;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Real Cashflow connector — pulls the last 90 days of transactions read-only
 *  from cashflow's /api/v1 reporting API. Requires CASHFLOW_API_BASE_URL + CASHFLOW_API_TOKEN. */
export const cashflowConnector: Connector = {
  sourceType: "cashflow",
  async sync() {
    const { CASHFLOW_API_BASE_URL: baseUrl, CASHFLOW_API_TOKEN: token } = env();
    if (!baseUrl || !token) {
      throw new Error("cashflow connector requires CASHFLOW_API_BASE_URL + CASHFLOW_API_TOKEN");
    }
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return fetchCashflowTransactions(baseUrl, token, { start: ymd(start), end: ymd(end) });
  },
};
