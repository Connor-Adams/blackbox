import type { CashflowAccount } from "@/lib/connectors/cashflow-api";

export function AccountsList({ accounts }: { accounts: CashflowAccount[] }) {
  if (accounts.length === 0) {
    return <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No accounts.</div>;
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Accounts</div>
      <ul className="divide-y divide-border">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between py-1.5 text-sm">
            <span>{a.name} <span className="text-[10px] uppercase text-muted-foreground">{a.type}</span></span>
            <span className="tabular-nums">{a.currency} {Math.round(a.balance).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
