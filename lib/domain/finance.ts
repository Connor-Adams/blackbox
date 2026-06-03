export interface FinanceTxn { id: string; title: string; amount: number; timestamp: string; category: string | null; }

export function pickTransactions(txns: readonly FinanceTxn[], opts: { recentLimit: number; largestLimit: number }): { recent: FinanceTxn[]; largest: FinanceTxn[] } {
  const byTime = [...txns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const byAmount = [...txns].sort((a, b) => b.amount - a.amount);
  return { recent: byTime.slice(0, opts.recentLimit), largest: byAmount.slice(0, opts.largestLimit) };
}
