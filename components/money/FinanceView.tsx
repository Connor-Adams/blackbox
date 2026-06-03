import { StateCard } from "@/components/today/StateCard";
import { MonthlyChart } from "./MonthlyChart";
import { CategoryBars } from "./CategoryBars";
import { AccountsList } from "./AccountsList";
import { TransactionsList } from "./TransactionsList";
import type { CashflowDashboard } from "@/lib/connectors/cashflow-dashboard";
import type { FinanceTxn } from "@/lib/domain/finance";

export function FinanceView({ dashboard, recent, largest }: { dashboard: CashflowDashboard; recent: FinanceTxn[]; largest: FinanceTxn[] }) {
  const s = dashboard.summary;
  const cur = s?.currency ?? "";
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Money</h1>
      {s ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StateCard label="Net worth" value={money(s.netWorth)} />
          <StateCard label="Liquid cash" value={money(s.liquidCash)} />
          <StateCard label="Monthly burn" value={money(s.monthlyBurn)} />
          <StateCard label="Runway" value={`${Math.round(s.runwayMonths)} mo`} />
          <StateCard label="Savings rate" value={`${Math.round(s.monthlySavingsRate * 100)}%`} />
        </div>
      ) : (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Top-line metrics unavailable (cashflow API unreachable).</div>
      )}
      {dashboard.monthly ? <MonthlyChart months={dashboard.monthly.months} /> : null}
      {dashboard.byCategory ? <CategoryBars categories={dashboard.byCategory.categories} /> : null}
      {dashboard.accounts ? <AccountsList accounts={dashboard.accounts.accounts} /> : null}
      <TransactionsList recent={recent} largest={largest} />
    </div>
  );
}
