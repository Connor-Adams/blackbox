import { mapCashflowTransaction, type CashflowApiTransaction } from "./cashflow-map";
import type { CashflowTransactionPayload } from "@/lib/domain/types";

export async function cashflowGet<T>(baseUrl: string, token: string, path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`cashflow API ${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

export interface CashflowSummary { currency: string; netWorth: number; liquidCash: number; monthlyBurn: number; monthlyIncome: number; monthlySavingsRate: number; runwayMonths: number; }
export interface CashflowAccount { id: number; name: string; type: string; currency: string; balance: number; updatedAt?: string; }
export interface CashflowMonth { month: string; income: number; expenses: number; netCashflow: number; savingsRate: number; }
export interface CashflowCategory { name: string; amount: number; percentage: number; transactionCount: number; trendVsPreviousPeriod: number; }

export const fetchCashflowSummary = (b: string, t: string, f: typeof fetch = fetch) => cashflowGet<CashflowSummary>(b, t, "/api/v1/summary", f);
export const fetchCashflowAccounts = (b: string, t: string, f: typeof fetch = fetch) => cashflowGet<{ accounts: CashflowAccount[] }>(b, t, "/api/v1/accounts", f);
export const fetchCashflowMonthly = (b: string, t: string, f: typeof fetch = fetch) => cashflowGet<{ months: CashflowMonth[] }>(b, t, "/api/v1/cashflow/monthly", f);
export const fetchCashflowByCategory = (b: string, t: string, range: { start: string; end: string }, f: typeof fetch = fetch) => cashflowGet<{ categories: CashflowCategory[] }>(b, t, `/api/v1/spending/by-category?start=${range.start}&end=${range.end}`, f);

/** Fetch + paginate cashflow transactions in [start,end], mapped to blackbox payloads.
 *  Pure of env — base/token passed in — so it's testable with a stubbed fetch. */
export async function fetchCashflowTransactions(
  baseUrl: string,
  token: string,
  range: { start: string; end: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CashflowTransactionPayload[]> {
  const out: CashflowTransactionPayload[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL("/api/v1/transactions", baseUrl);
    url.searchParams.set("start", range.start);
    url.searchParams.set("end", range.end);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`cashflow API ${res.status} ${res.statusText} for ${url.pathname}`);
    }
    const body = (await res.json()) as { transactions: CashflowApiTransaction[]; nextCursor?: string };
    out.push(...body.transactions.map(mapCashflowTransaction));
    cursor = body.nextCursor;
  } while (cursor);
  return out;
}
