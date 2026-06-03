import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { insight } from "@/lib/db/schema";
import { getTimeline } from "@/lib/db/store";
import { dayRange } from "@/lib/domain/time";
import { computeInsights } from "@/lib/domain/insights";
import type { InsightSeverity } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

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
  const computed = computeInsights({
    observations: observations.map((o) => ({ id: o.id, metric: o.metric, value: o.value, observedAt: o.observedAt })),
    timelineEvents: events.map((e) => ({ id: e.id, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata })),
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
