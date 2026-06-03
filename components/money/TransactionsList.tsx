import Link from "next/link";
import type { FinanceTxn } from "@/lib/domain/finance";

function Row({ t }: { t: FinanceTxn }) {
  const day = t.timestamp.slice(0, 10);
  return (
    <li>
      <Link href={`/timeline?date=${day}`} className="flex items-center justify-between gap-3 py-1.5 text-sm hover:bg-muted">
        <span className="truncate">{t.title}{t.category ? <span className="ml-2 text-[10px] uppercase text-muted-foreground">{t.category}</span> : null}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{day} · ${Math.round(t.amount)}</span>
      </Link>
    </li>
  );
}

export function TransactionsList({ recent, largest }: { recent: FinanceTxn[]; largest: FinanceTxn[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-sm font-medium">Recent</div>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y divide-border">{recent.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-sm font-medium">Largest</div>
        {largest.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <ul className="divide-y divide-border">{largest.map((t) => <Row key={t.id} t={t} />)}</ul>}
      </div>
    </div>
  );
}
