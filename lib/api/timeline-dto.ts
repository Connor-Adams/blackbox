import { orderTimeline } from "@/lib/domain/ordering";
import type { observation, timelineEvent } from "@/lib/db/schema";

type EventRow = typeof timelineEvent.$inferSelect;
type ObservationRow = typeof observation.$inferSelect;

export interface TimelineEventDTO {
  id: string;
  sourceType: string;
  eventType: string;
  title: string;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  metadata: Record<string, unknown>;
}
export interface GlucosePointDTO {
  observedAt: string;
  value: number;
  unit: string;
}
export interface TimelineDTO {
  date: string;
  events: TimelineEventDTO[];
  glucose: GlucosePointDTO[];
}

/** Pure mapping of DB rows → the timeline payload the UI consumes. */
export function serializeTimeline(
  date: string,
  data: { events: EventRow[]; observations: ObservationRow[] },
): TimelineDTO {
  const events = orderTimeline(data.events).map((e) => ({
    id: e.id,
    sourceType: e.sourceType,
    eventType: e.eventType,
    title: e.title,
    description: e.description ?? null,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    metadata: e.metadata ?? {},
  }));
  const glucose = data.observations
    .filter((o) => o.metric === "glucose")
    .map((o) => ({ observedAt: o.observedAt.toISOString(), value: o.value, unit: o.unit }))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return { date, events, glucose };
}
