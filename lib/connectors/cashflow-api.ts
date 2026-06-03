import { mapCashflowTransaction, type CashflowApiTransaction } from "./cashflow-map";
import type { CashflowTransactionPayload } from "@/lib/domain/types";

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
