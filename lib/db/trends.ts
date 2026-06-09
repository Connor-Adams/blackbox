import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observation, dailyTrend, type ObservationMetric } from "@/lib/db/schema";
import { computeTrend, type DailyMetricValue, type ComputedTrend } from "@/lib/domain/trends";

type Db = ReturnType<typeof getDb>;

const WINDOW_DAYS = 30;
const TRACKED_METRICS = [
  "glucose", "sleep_duration", "sleep_score", "steps", "intensity_minutes",
  "hrv", "resting_heart_rate", "body_battery", "training_readiness",
] as const;

export async function getDailyMetricAverages(
  userId: string,
  startDate: string,
  endDate: string,
  db: Db = getDb(),
): Promise<Map<string, DailyMetricValue[]>> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const rows = await db
    .select({
      metric: observation.metric,
      day: sql<string>`date(${observation.observedAt} at time zone 'UTC')`.as("day"),
      avg: sql<number>`avg(${observation.value})`.as("avg"),
    })
    .from(observation)
    .where(
      and(
        eq(observation.userId, userId),
        sql`${observation.metric} in (${sql.join(TRACKED_METRICS.map((m) => sql`${m}`), sql`, `)})`,
        gte(observation.observedAt, start),
        lt(observation.observedAt, end),
      ),
    )
    .groupBy(observation.metric, sql`day`);

  const result = new Map<string, DailyMetricValue[]>();
  for (const r of rows) {
    const values = result.get(r.metric) ?? [];
    values.push({ date: r.day, value: Number(r.avg) });
    result.set(r.metric, values);
  }
  return result;
}

export async function getTrends(userId: string, date: string, db: Db = getDb()) {
  return db
    .select()
    .from(dailyTrend)
    .where(and(eq(dailyTrend.userId, userId), eq(dailyTrend.date, date)));
}

export async function computeAndStoreTrends(userId: string, date: string, db: Db = getDb()): Promise<number> {
  const windowStart = new Date(`${date}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);
  const startDate = windowStart.toISOString().slice(0, 10);

  const metricHistory = await getDailyMetricAverages(userId, startDate, date, db);
  let count = 0;

  for (const [metric, allValues] of metricHistory) {
    const todayEntry = allValues.find((v) => v.date === date);
    if (!todayEntry) continue;

    const history = allValues.filter((v) => v.date !== date);
    const trend = computeTrend({ metric, todayValue: todayEntry.value, today: date, history });

    const row = {
      value: trend.value,
      baseline7d: trend.baseline7d,
      baseline30d: trend.baseline30d,
      delta7dPct: trend.delta7dPct,
      delta30dPct: trend.delta30dPct,
      direction: trend.direction,
      streak: trend.streak,
      sampleCount7d: trend.sampleCount7d,
      sampleCount30d: trend.sampleCount30d,
      updatedAt: new Date(),
    };

    const typedMetric = metric as ObservationMetric;

    const [existing] = await db
      .select({ id: dailyTrend.id })
      .from(dailyTrend)
      .where(and(eq(dailyTrend.userId, userId), eq(dailyTrend.date, date), eq(dailyTrend.metric, typedMetric)))
      .limit(1);

    if (existing) {
      await db.update(dailyTrend).set(row).where(eq(dailyTrend.id, existing.id));
    } else {
      await db.insert(dailyTrend).values({ userId, date, metric: typedMetric, ...row });
    }
    count++;
  }
  return count;
}
