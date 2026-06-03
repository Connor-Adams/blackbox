import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dailySnapshot } from "@/lib/db/schema";
import { getTimeline } from "@/lib/db/store";
import { computeDailySnapshot, type DailySnapshotSummary } from "@/lib/domain/snapshot";

type Db = ReturnType<typeof getDb>;

export async function getDailySnapshot(userId: string, date: string, db: Db = getDb()) {
  const [row] = await db
    .select()
    .from(dailySnapshot)
    .where(and(eq(dailySnapshot.userId, userId), eq(dailySnapshot.date, date)))
    .limit(1);
  return row ?? null;
}

/** Compute the day's snapshot from normalized data and upsert it (idempotent on
 *  (userId, date)). Returns the computed summary. */
export async function computeAndStoreSnapshot(
  userId: string,
  date: string,
  db: Db = getDb(),
): Promise<DailySnapshotSummary> {
  const { events, observations } = await getTimeline(userId, date, db);
  const summary = computeDailySnapshot({
    observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
    timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
  });

  const existing = await getDailySnapshot(userId, date, db);
  if (existing) {
    await db
      .update(dailySnapshot)
      .set({ summaryJson: summary as Record<string, unknown>, timezone: "UTC", updatedAt: new Date() })
      .where(eq(dailySnapshot.id, existing.id));
  } else {
    await db.insert(dailySnapshot).values({ userId, date, timezone: "UTC", summaryJson: summary as Record<string, unknown> });
  }
  return summary;
}
