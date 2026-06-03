"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InsightDTO } from "@/lib/api/insight-dto";

const SEVERITIES = ["critical", "warning", "notice", "info"] as const;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InsightsView({ date, insights }: { date: string; insights: InsightDTO[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const present = Array.from(new Set(insights.map((i) => i.severity)));
  const shown = insights.filter((i) => !hidden.has(i.severity));

  async function dismiss(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/insights/dismiss?id=${id}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/insights?date=${shiftDate(date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{date}</span>
          <Link href={`/insights?date=${shiftDate(date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      {present.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {SEVERITIES.filter((s) => present.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() =>
                setHidden((p) => {
                  const n = new Set(p);
                  if (n.has(s)) n.delete(s);
                  else n.add(s);
                  return n;
                })
              }
              className={`rounded border px-2 py-1 ${hidden.has(s) ? "border-border text-muted-foreground line-through" : "border-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No active insights for this day.</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{i.severity}</span>
                    <span className="text-sm font-medium">{i.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>
                </div>
                <button type="button" onClick={() => dismiss(i.id)} disabled={busy === i.id} className="shrink-0 text-xs text-muted-foreground hover:underline">
                  {busy === i.id ? "…" : "dismiss"}
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOpen((p) => {
                    const n = new Set(p);
                    if (n.has(i.id)) n.delete(i.id);
                    else n.add(i.id);
                    return n;
                  })
                }
                className="mt-2 text-xs underline underline-offset-4"
              >
                {open.has(i.id) ? "hide evidence" : "evidence"}
              </button>
              {open.has(i.id) && (
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                  {JSON.stringify({ evidence: i.evidence, observations: i.sourceObservationIds, events: i.sourceTimelineEventIds }, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link href={`/today?date=${date}`} className="inline-block text-sm underline underline-offset-4">← Back to today</Link>
    </div>
  );
}
