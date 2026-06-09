import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { correlation } from "@/lib/db/schema";
import { getDailyMetricAverages } from "@/lib/db/trends";
import {
  computeCorrelation,
  CO_FACTOR_DEFS,
  type CorrelationConfig,
  type DailyPair,
} from "@/lib/domain/correlations";

type Db = ReturnType<typeof getDb>;

const WINDOW_DAYS = 30;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function getCorrelations(userId: string, date: string, db: Db = getDb()) {
  return db
    .select()
    .from(correlation)
    .where(and(eq(correlation.userId, userId), eq(correlation.date, date)));
}

export async function computeAndStoreCorrelations(userId: string, date: string, db: Db = getDb()): Promise<number> {
  const windowStart = new Date(`${date}T00:00:00Z`);
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);
  const startDate = windowStart.toISOString().slice(0, 10);

  const metricHistory = await getDailyMetricAverages(userId, startDate, date, db);
  const glucoseByDate = new Map<string, number>();
  for (const v of metricHistory.get("glucose") ?? []) {
    glucoseByDate.set(v.date, v.value);
  }

  let count = 0;

  for (const def of CO_FACTOR_DEFS) {
    const coFactorValues = metricHistory.get(def.metric);
    if (!coFactorValues) continue;

    const pairs: DailyPair[] = [];
    for (const cv of coFactorValues) {
      const gv = glucoseByDate.get(cv.date);
      if (gv !== undefined) {
        pairs.push({ date: cv.date, primaryValue: gv, coFactorValue: cv.value });
      }
    }

    let splitThreshold: number;
    if (def.threshold === "median") {
      if (coFactorValues.length < 5) continue;
      splitThreshold = median(coFactorValues.map((v) => v.value));
    } else {
      splitThreshold = def.threshold;
    }

    const config: CorrelationConfig = {
      primaryMetric: "glucose",
      coFactorMetric: def.metric,
      splitThreshold,
      splitLabel: def.label,
      windowDays: WINDOW_DAYS,
    };

    const result = computeCorrelation(config, pairs);

    const row = {
      windowDays: result.windowDays,
      sampleCount: result.sampleCount,
      splitThreshold: result.splitThreshold,
      splitLabel: result.splitLabel,
      primaryWhenBelow: result.primaryWhenBelow,
      primaryWhenAbove: result.primaryWhenAbove,
      countBelow: result.countBelow,
      countAbove: result.countAbove,
      deltaAbs: result.deltaAbs,
      deltaPct: result.deltaPct,
      significant: result.significant ? 1 : 0,
      narrative: result.narrative,
      evidenceJson: result.evidence as Record<string, unknown>,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: correlation.id })
      .from(correlation)
      .where(
        and(
          eq(correlation.userId, userId),
          eq(correlation.date, date),
          eq(correlation.primaryMetric, "glucose"),
          eq(correlation.coFactorMetric, def.metric),
        ),
      )
      .limit(1);

    if (existing) {
      await db.update(correlation).set(row).where(eq(correlation.id, existing.id));
    } else {
      await db.insert(correlation).values({
        userId,
        date,
        primaryMetric: "glucose",
        coFactorMetric: def.metric,
        ...row,
      });
    }
    count++;
  }
  return count;
}
