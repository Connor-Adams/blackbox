"use client";

import type { TimelineEventDTO } from "@/lib/api/timeline-dto";

export function EventList({
  events,
  onSelect,
}: {
  events: TimelineEventDTO[];
  onSelect: (event: TimelineEventDTO) => void;
}) {
  if (events.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No events for this day. Add one below.</div>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {events.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect(e)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
          >
            <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(e.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {e.sourceType}
            </span>
            <span className="flex-1 truncate text-sm">{e.title}</span>
            <span className="text-xs text-muted-foreground">{e.eventType}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
