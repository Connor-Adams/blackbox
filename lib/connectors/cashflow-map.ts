import type { CashflowTransactionPayload } from "@/lib/domain/types";

/** One cashflow /api/v1/transactions row. */
export interface CashflowApiTransaction {
  id: number;
  date: string; // YYYY-MM-DD
  merchant?: string;
  description?: string;
  amount: number; // signed; negative = spend
  currency?: string;
  category?: string | null;
}

/** Map a cashflow transaction to blackbox's payload. NEGATE the amount
 *  (cashflow negative=spend → blackbox positive=spend). Date-only → midday UTC. */
export function mapCashflowTransaction(t: CashflowApiTransaction): CashflowTransactionPayload {
  return {
    recordId: String(t.id),
    amount: -t.amount,
    description: t.merchant || t.description || `txn ${t.id}`,
    timestamp: `${t.date}T12:00:00Z`,
    category: t.category ?? undefined,
  };
}
