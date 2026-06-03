import { env } from "@/lib/env";
import {
  fetchCashflowSummary, fetchCashflowAccounts, fetchCashflowMonthly, fetchCashflowByCategory,
  type CashflowSummary, type CashflowAccount, type CashflowMonth, type CashflowCategory,
} from "./cashflow-api";

export interface CashflowDashboard {
  summary: CashflowSummary | null;
  accounts: { accounts: CashflowAccount[] } | null;
  monthly: { months: CashflowMonth[] } | null;
  byCategory: { categories: CashflowCategory[] } | null;
}

const WINDOW_DAYS = 90;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function ok<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === "fulfilled" ? r.value : null;
}

export async function getCashflowDashboard(opts?: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch }): Promise<CashflowDashboard> {
  const e = (() => { try { return env(); } catch { return { CASHFLOW_API_BASE_URL: undefined, CASHFLOW_API_TOKEN: undefined } as ReturnType<typeof env>; } })();
  const baseUrl = opts?.baseUrl ?? e.CASHFLOW_API_BASE_URL;
  const token = opts?.token ?? e.CASHFLOW_API_TOKEN;
  const f = opts?.fetchImpl ?? fetch;
  if (!baseUrl || !token) return { summary: null, accounts: null, monthly: null, byCategory: null };
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [summary, accounts, monthly, byCategory] = await Promise.allSettled([
    fetchCashflowSummary(baseUrl, token, f),
    fetchCashflowAccounts(baseUrl, token, f),
    fetchCashflowMonthly(baseUrl, token, f),
    fetchCashflowByCategory(baseUrl, token, { start: ymd(start), end: ymd(end) }, f),
  ]);
  return { summary: ok(summary), accounts: ok(accounts), monthly: ok(monthly), byCategory: ok(byCategory) };
}
