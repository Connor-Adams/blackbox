import type { CashflowCategory } from "@/lib/connectors/cashflow-api";

export function CategoryBars({ categories }: { categories: CashflowCategory[] }) {
  if (categories.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No category data.</div>;
  }
  const top = [...categories].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const max = Math.max(...top.map((c) => Math.abs(c.amount)), 1);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Spending by category</div>
      <ul className="space-y-1.5">
        {top.map((c) => (
          <li key={c.name} className="text-sm">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{c.name}</span>
              <span className="tabular-nums">${Math.round(Math.abs(c.amount))} · {Math.round(c.percentage)}%</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-muted">
              <div className="h-1.5 rounded bg-foreground/50" style={{ width: `${(Math.abs(c.amount) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
