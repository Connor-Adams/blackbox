"use client";

import { useState } from "react";
import Link from "next/link";
import type { TimelineDTO, TimelineEventDTO } from "@/lib/api/timeline-dto";
import { GlucoseStrip } from "./GlucoseStrip";
import { MetricStrips } from "./MetricStrips";
import { EventList } from "./EventList";
import { AnnotationForm } from "./AnnotationForm";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TimelineView({ timeline }: { timeline: TimelineDTO }) {
  const sources = Array.from(new Set(timeline.events.map((e) => e.sourceType)));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TimelineEventDTO | null>(null);

  const events = timeline.events.filter((e) => !hidden.has(e.sourceType));

  function toggle(src: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/timeline?date=${shiftDate(timeline.date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{timeline.date}</span>
          <Link href={`/timeline?date=${shiftDate(timeline.date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      <GlucoseStrip glucose={timeline.glucose} />

      <MetricStrips series={timeline.series} />

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {sources.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => toggle(src)}
              className={`rounded border px-2 py-1 ${hidden.has(src) ? "border-border text-muted-foreground line-through" : "border-foreground"}`}
            >
              {src}
            </button>
          ))}
        </div>
      )}

      <EventList events={events} onSelect={setSelected} />

      {selected && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{selected.title}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:underline">close</button>
          </div>
          <div className="text-xs text-muted-foreground">
            {selected.sourceType} · {selected.eventType} · {new Date(selected.startedAt).toLocaleString()}
          </div>
          {selected.description && <p className="mt-1">{selected.description}</p>}
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(selected.metadata, null, 2)}</pre>
        </div>
      )}

      <AnnotationForm date={timeline.date} />
    </div>
  );
}
