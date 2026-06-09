import { and, eq, gte, lt, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { insight, observation } from "@/lib/db/schema";
import { getTimeline } from "@/lib/db/store";
import { dayRange } from "@/lib/domain/time";
import { computeInsights, type MetricBaseline } from "@/lib/domain/insights";
import type { InsightSeverity, ObservationMetric } from "@/lib/db/schema";
import { getTrends } from "@/lib/db/trends";
import { getCorrelations } from "@/lib/db/correlations";
import type { ComputedTrend } from "@/lib/domain/trends";
import type { ComputedCorrelation } from "@/lib/domain/correlations";

type Db = ReturnType<typeof getDb>;

// Metrics that get a trailing daily baseline (for baseline insight rules).
const BASELINE_METRICS: ObservationMetric[] = ["resting_heart_rate", "sleep_score", "hrv"];
const BASELINE_DAYS = 14;

/** Per-metric daily baseline (mean/stddev of each day's mean value) over the
 *  BASELINE_DAYS days before `date`. Pure-ish: one read query. */
export async function getBaseline(userId: string, date: string, db: Db = getDb()): Promise<Record<string, MetricBaseline>> {
  const windowEnd = dayRange(date).start; // start of the target day (exclusive upper bound)
  const windowStart = new Date(windowEnd.getTime() - BASELINE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ metric: observation.metric, value: observation.value, observedAt: observation.observedAt })
    .from(observation)
    .where(
      and(
        eq(observation.userId, userId),
        inArray(observation.metric, BASELINE_METRICS),
        gte(observation.observedAt, windowStart),
        lt(observation.observedAt, windowEnd),
      ),
    );

  // metric -> dayKey -> values
  const byMetricDay = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    const dayKey = r.observedAt.toISOString().slice(0, 10);
    const days = byMetricDay.get(r.metric) ?? new Map<string, number[]>();
    (days.get(dayKey) ?? days.set(dayKey, []).get(dayKey)!).push(r.value);
    byMetricDay.set(r.metric, days);
  }

  const out: Record<string, MetricBaseline> = {};
  for (const [metric, days] of byMetricDay) {
    const dailyMeans = [...days.values()].map((vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
    const n = dailyMeans.length;
    if (n === 0) continue;
    const mean = dailyMeans.reduce((a, b) => a + b, 0) / n;
    const stddev = Math.sqrt(dailyMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    out[metric] = { mean, stddev, n };
  }
  return out;
}

export async function getInsights(userId: string, date: string, db: Db = getDb()) {
  return db
    .select()
    .from(insight)
    .where(and(eq(insight.userId, userId), eq(insight.date, date)));
}

export async function dismissInsight(id: string, db: Db = getDb()): Promise<void> {
  await db.update(insight).set({ status: "dismissed" }).where(eq(insight.id, id));
}

/** Recompute the day's insights, upserting on (userId, date, insightType) and
 *  PRESERVING an existing row's status (recompute never un-dismisses). */
export async function computeAndStoreInsights(userId: string, date: string, db: Db = getDb()) {
  const { start, end } = dayRange(date);
  const { events, observations } = await getTimeline(userId, date, db);
  const baseline = await getBaseline(userId, date, db);

  const trendRows = await getTrends(userId, date, db);
  const trends: ComputedTrend[] = trendRows.map((t) => ({
    metric: t.metric,
    value: t.value,
    baseline7d: t.baseline7d,
    baseline30d: t.baseline30d,
    delta7dPct: t.delta7dPct,
    delta30dPct: t.delta30dPct,
    direction: t.direction as "rising" | "falling" | "stable",
    streak: t.streak,
    sampleCount7d: t.sampleCount7d,
    sampleCount30d: t.sampleCount30d,
  }));

  const corrRows = await getCorrelations(userId, date, db);
  const correlations: ComputedCorrelation[] = corrRows.map((c) => ({
    primaryMetric: c.primaryMetric,
    coFactorMetric: c.coFactorMetric,
    windowDays: c.windowDays,
    sampleCount: c.sampleCount,
    splitThreshold: c.splitThreshold,
    splitLabel: c.splitLabel,
    primaryWhenBelow: c.primaryWhenBelow,
    primaryWhenAbove: c.primaryWhenAbove,
    countBelow: c.countBelow,
    countAbove: c.countAbove,
    deltaAbs: c.deltaAbs,
    deltaPct: c.deltaPct,
    significant: c.significant === 1,
    narrative: c.narrative,
    evidence: c.evidenceJson as Record<string, unknown>,
  }));

  const computed = computeInsights({
    observations: observations.map((o) => ({ id: o.id, metric: o.metric, value: o.value, observedAt: o.observedAt })),
    timelineEvents: events.map((e) => ({ id: e.id, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata })),
    baseline,
    trends,
    correlations,
  });

  for (const c of computed) {
    const [existing] = await db
      .select({ id: insight.id })
      .from(insight)
      .where(and(eq(insight.userId, userId), eq(insight.date, date), eq(insight.insightType, c.insightType)))
      .limit(1);

    const content = {
      severity: c.severity as InsightSeverity,
      title: c.title,
      summary: c.summary,
      evidenceJson: c.evidence as Record<string, unknown>,
      sourceObservationIds: c.sourceObservationIds,
      sourceTimelineEventIds: c.sourceTimelineEventIds,
      timeRangeStart: start,
      timeRangeEnd: end,
    };

    if (existing) {
      await db.update(insight).set(content).where(eq(insight.id, existing.id));
    } else {
      await db.insert(insight).values({ userId, date, insightType: c.insightType, status: "active", ...content });
    }
  }
  return computed.length;
}
