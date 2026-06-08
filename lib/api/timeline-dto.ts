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
export interface MetricSeriesDTO {
  metric: string;
  unit: string;
  points: { observedAt: string; value: number }[];
}
export interface TimelineDTO {
  date: string;
  events: TimelineEventDTO[];
  glucose: GlucosePointDTO[];
  /** Non-glucose health observation series for the day, grouped by metric and
   *  sorted (dense intraday metrics first). Finance metrics live on /money. */
  series: MetricSeriesDTO[];
}

// Observation metrics that belong on the finance page, not the health timeline.
const FINANCE_METRICS = new Set(["cash_balance", "daily_spend", "transaction_amount"]);

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

  // Group the remaining (non-glucose, non-finance) observations into per-metric series.
  const seriesByMetric = new Map<string, MetricSeriesDTO>();
  for (const o of data.observations) {
    if (o.metric === "glucose" || FINANCE_METRICS.has(o.metric)) continue;
    let s = seriesByMetric.get(o.metric);
    if (!s) {
      s = { metric: o.metric, unit: o.unit, points: [] };
      seriesByMetric.set(o.metric, s);
    }
    s.points.push({ observedAt: o.observedAt.toISOString(), value: o.value });
  }
  const series = [...seriesByMetric.values()]
    .map((s) => ({ ...s, points: s.points.sort((a, b) => a.observedAt.localeCompare(b.observedAt)) }))
    // densest (intraday) series first, then alphabetical.
    .sort((a, b) => b.points.length - a.points.length || a.metric.localeCompare(b.metric));

  return { date, events, glucose, series };
}
