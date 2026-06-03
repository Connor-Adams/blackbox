import Link from "next/link";
import { getTimeline } from "@/lib/db/store";
import { computeDailySnapshot } from "@/lib/domain/snapshot";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { StateCard } from "@/components/today/StateCard";

export const dynamic = "force-dynamic";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let date = rawDate ?? today;
  try {
    dayRange(date);
  } catch {
    date = today;
  }

  const { events, observations } = await getTimeline(SEED_USER_ID, date);
  const s = computeDailySnapshot({
    observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
    timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
  });

  const glucoseValue = s.glucose ? `${s.glucose.average} mmol/L` : "unknown";
  const glucoseSub = s.glucose
    ? `${s.glucose.readingCount} readings · ${s.glucose.min}–${s.glucose.max} · TIR ${Math.round((s.glucose.estimatedTimeInRange ?? 0) * 100)}%`
    : "no readings";

  const financeValue = s.finance ? `$${s.finance.spendTotal}` : "unknown";
  const financeSub = s.finance ? `${s.finance.transactionCount} transactions` : "no finance data yet";

  const annotationValue = s.annotations ? String(s.annotations.count) : "0";
  const annotationSub = s.annotations
    ? Object.entries(s.annotations.types).map(([t, n]) => `${t}×${n}`).join(" · ")
    : "no annotations";

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Today</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/today?date=${shiftDate(date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{date}</span>
          <Link href={`/today?date=${shiftDate(date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StateCard label="Glucose" value={glucoseValue} sub={glucoseSub} />
        <StateCard label="Finance" value={financeValue} sub={financeSub} />
        <StateCard label="Annotations" value={annotationValue} sub={annotationSub} />
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Top insights</div>
        <p className="mt-1 text-sm text-muted-foreground">No insights yet — coming in a later phase.</p>
      </section>

      <Link href={`/timeline?date=${date}`} className="inline-block text-sm underline underline-offset-4">
        View full timeline →
      </Link>
    </main>
  );
}
