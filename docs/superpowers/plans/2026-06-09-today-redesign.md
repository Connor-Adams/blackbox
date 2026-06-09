# /today Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat /today page with a 3-column data-dense health briefing featuring per-metric trends (7d/30d baselines), glucose correlation discovery engine, and extended insight rules.

**Architecture:** Two new DB tables (`daily_trend`, `correlation`) pre-computed by new steps in the daily job pipeline (`snapshot → trends → correlations → insights`). Pure domain functions compute trends and correlations; DB layer orchestrates fetch + compute + upsert. /today page reads pre-computed data from all four tables.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM 0.44, Postgres, Tailwind, vitest, pnpm

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `lib/db/schema.ts` | Add `dailyTrend` and `correlation` tables |
| Create | `lib/domain/trends.ts` | Pure `computeTrend()` function |
| Create | `lib/domain/trends.test.ts` | Tests for trend computation |
| Create | `lib/domain/correlations.ts` | Pure `computeCorrelation()` + co-factor config |
| Create | `lib/domain/correlations.test.ts` | Tests for correlation computation |
| Create | `lib/db/trends.ts` | `computeAndStoreTrends()`, `getTrends()`, `getDailyMetricAverages()` |
| Create | `lib/db/correlations.ts` | `computeAndStoreCorrelations()`, `getCorrelations()` |
| Modify | `lib/domain/insights.ts` | Add `InsightInput.trends` + `InsightInput.correlations` fields, 4 new rules |
| Modify | `lib/domain/insights.test.ts` | Tests for new insight rules |
| Modify | `lib/db/insights.ts` | Fetch trends + correlations before calling `computeInsights()` |
| Modify | `lib/inngest/functions.ts` | Add `dailyTrends` + `dailyCorrelations` Inngest functions |
| Create | `app/api/jobs/trends/route.ts` | Synchronous trend recompute route |
| Create | `app/api/jobs/correlations/route.ts` | Synchronous correlation recompute route |
| Modify | `.github/workflows/daily-refresh.yml` | Add trend + correlation steps to cron |
| Rewrite | `app/today/page.tsx` | 3-column data-dense layout |
| Delete | `components/today/StateCard.tsx` | No longer used (replaced by inline layout) |

---

### Task 1: Schema — `daily_trend` and `correlation` tables

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add `dailyTrend` table to schema**

Add after the existing `dailySnapshot` table definition in `lib/db/schema.ts`:

```typescript
export const trendDirections = ["rising", "falling", "stable"] as const;
export type TrendDirection = (typeof trendDirections)[number];

export const dailyTrend = pgTable(
  "daily_trend",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    metric: text("metric").$type<ObservationMetric>().notNull(),
    value: doublePrecision("value").notNull(),
    baseline7d: doublePrecision("baseline_7d"),
    baseline30d: doublePrecision("baseline_30d"),
    delta7dPct: doublePrecision("delta_7d_pct"),
    delta30dPct: doublePrecision("delta_30d_pct"),
    direction: text("direction").$type<TrendDirection>().notNull().default("stable"),
    streak: integer("streak").notNull().default(0),
    sampleCount7d: integer("sample_count_7d").notNull().default(0),
    sampleCount30d: integer("sample_count_30d").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_trend_user_date_metric_uq").on(t.userId, t.date, t.metric),
  ],
);
```

- [ ] **Step 2: Add `correlation` table to schema**

Add after `dailyTrend` in `lib/db/schema.ts`:

```typescript
export const correlation = pgTable(
  "correlation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    primaryMetric: text("primary_metric").notNull(),
    coFactorMetric: text("co_factor_metric").notNull(),
    windowDays: integer("window_days").notNull().default(30),
    sampleCount: integer("sample_count").notNull().default(0),
    splitThreshold: doublePrecision("split_threshold").notNull(),
    splitLabel: text("split_label").notNull(),
    primaryWhenBelow: doublePrecision("primary_when_below"),
    primaryWhenAbove: doublePrecision("primary_when_above"),
    countBelow: integer("count_below").notNull().default(0),
    countAbove: integer("count_above").notNull().default(0),
    deltaAbs: doublePrecision("delta_abs"),
    deltaPct: doublePrecision("delta_pct"),
    significant: integer("significant").notNull().default(0),
    narrative: text("narrative").notNull().default(""),
    evidenceJson: jsonb("evidence_json").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("correlation_user_date_metrics_uq").on(t.userId, t.date, t.primaryMetric, t.coFactorMetric),
  ],
);
```

Note: `significant` is `integer` (0/1) because Drizzle's `boolean()` can cause issues with some Postgres drivers. The domain layer treats it as boolean.

- [ ] **Step 3: Also add `boolean` import if not already present**

Check the existing import from `drizzle-orm/pg-core`. The import line already has `integer` which we use. No new imports needed — `doublePrecision`, `integer`, `text`, `jsonb`, `uuid`, `date`, `timestamp`, `uniqueIndex` are all already imported.

- [ ] **Step 4: Generate migration**

Run: `pnpm db:generate`
Expected: A new migration file in `drizzle/` creating both tables.

- [ ] **Step 5: Apply migration**

Run: `pnpm db:push`
Expected: Tables created in the database.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(schema): add daily_trend and correlation tables"
```

---

### Task 2: Pure domain — `computeTrend()`

**Files:**
- Create: `lib/domain/trends.ts`
- Create: `lib/domain/trends.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/domain/trends.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeTrend, type TrendInput } from "@/lib/domain/trends";

function days(count: number, baseValue: number, stepPerDay = 0): TrendInput["history"] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    value: baseValue + stepPerDay * i,
  }));
}

describe("computeTrend", () => {
  it("returns stable when delta7d < 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.7,
      today: "2026-06-15",
      history: days(14, 6.6),
    });
    expect(result.direction).toBe("stable");
    expect(result.metric).toBe("glucose");
    expect(result.value).toBe(6.7);
  });

  it("returns rising when today > 7d baseline by ≥ 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 7.0,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.direction).toBe("rising");
    expect(result.delta7dPct).toBeGreaterThanOrEqual(3);
  });

  it("returns falling when today < 7d baseline by ≥ 3%", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.0,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.direction).toBe("falling");
    expect(result.delta7dPct).toBeLessThanOrEqual(-3);
  });

  it("computes 7d baseline from last 7 days only", () => {
    const history = [
      ...days(7, 10.0),
      { date: "2026-06-08", value: 6.0 },
      { date: "2026-06-09", value: 6.0 },
      { date: "2026-06-10", value: 6.0 },
      { date: "2026-06-11", value: 6.0 },
      { date: "2026-06-12", value: 6.0 },
      { date: "2026-06-13", value: 6.0 },
      { date: "2026-06-14", value: 6.0 },
    ];
    const result = computeTrend({ metric: "glucose", todayValue: 6.0, today: "2026-06-15", history });
    expect(result.baseline7d).toBe(6.0);
  });

  it("returns null baselines when insufficient samples", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(2, 6.5),
    });
    expect(result.baseline7d).toBeNull();
    expect(result.delta7dPct).toBeNull();
    expect(result.direction).toBe("stable");
  });

  it("computes streak from consecutive same-direction days", () => {
    const history = [
      { date: "2026-06-10", value: 6.0 },
      { date: "2026-06-11", value: 6.0 },
      { date: "2026-06-12", value: 6.5 },
      { date: "2026-06-13", value: 7.0 },
      { date: "2026-06-14", value: 7.5 },
    ];
    const result = computeTrend({ metric: "glucose", todayValue: 8.0, today: "2026-06-15", history });
    expect(result.streak).toBeGreaterThanOrEqual(3);
  });

  it("resets streak to 0 for stable direction", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(14, 6.5),
    });
    expect(result.streak).toBe(0);
  });

  it("returns correct sampleCounts", () => {
    const result = computeTrend({
      metric: "glucose",
      todayValue: 6.5,
      today: "2026-06-15",
      history: days(10, 6.5),
    });
    expect(result.sampleCount7d).toBe(7);
    expect(result.sampleCount30d).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/domain/trends.test.ts`
Expected: FAIL — module `@/lib/domain/trends` not found.

- [ ] **Step 3: Implement `computeTrend()`**

Create `lib/domain/trends.ts`:

```typescript
import type { TrendDirection } from "@/lib/db/schema";

export interface DailyMetricValue {
  date: string;
  value: number;
}

export interface TrendInput {
  metric: string;
  todayValue: number;
  today: string;
  history: DailyMetricValue[];
}

export interface ComputedTrend {
  metric: string;
  value: number;
  baseline7d: number | null;
  baseline30d: number | null;
  delta7dPct: number | null;
  delta30dPct: number | null;
  direction: TrendDirection;
  streak: number;
  sampleCount7d: number;
  sampleCount30d: number;
}

const MIN_SAMPLES_7D = 3;
const MIN_SAMPLES_30D = 7;
const STABLE_THRESHOLD_PCT = 3;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function daysAgo(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function computeTrend(input: TrendInput): ComputedTrend {
  const { metric, todayValue, today, history } = input;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

  const cutoff7d = daysAgo(today, 7);
  const last7d = sorted.filter((d) => d.date >= cutoff7d && d.date < today);
  const last30d = sorted.filter((d) => d.date < today);

  const baseline7d = last7d.length >= MIN_SAMPLES_7D ? round(avg(last7d.map((d) => d.value))) : null;
  const baseline30d = last30d.length >= MIN_SAMPLES_30D ? round(avg(last30d.map((d) => d.value))) : null;

  const delta7dPct = baseline7d !== null && baseline7d !== 0
    ? round(((todayValue - baseline7d) / baseline7d) * 100, 1)
    : null;
  const delta30dPct = baseline30d !== null && baseline30d !== 0
    ? round(((todayValue - baseline30d) / baseline30d) * 100, 1)
    : null;

  let direction: TrendDirection = "stable";
  if (delta7dPct !== null) {
    if (delta7dPct >= STABLE_THRESHOLD_PCT) direction = "rising";
    else if (delta7dPct <= -STABLE_THRESHOLD_PCT) direction = "falling";
  }

  let streak = 0;
  if (direction !== "stable" && sorted.length >= 2) {
    for (let i = sorted.length - 1; i >= 1; i--) {
      const curr = sorted[i]!.value;
      const prev = sorted[i - 1]!.value;
      const increasing = curr > prev;
      if (direction === "rising" && increasing) streak++;
      else if (direction === "falling" && !increasing) streak++;
      else break;
    }
    if (direction === "rising" && todayValue > sorted[sorted.length - 1]!.value) streak++;
    else if (direction === "falling" && todayValue < sorted[sorted.length - 1]!.value) streak++;
  }

  return {
    metric,
    value: todayValue,
    baseline7d,
    baseline30d,
    delta7dPct,
    delta30dPct,
    direction,
    streak,
    sampleCount7d: last7d.length,
    sampleCount30d: last30d.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lib/domain/trends.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/trends.ts lib/domain/trends.test.ts
git commit -m "feat(domain): pure computeTrend function with 7d/30d baselines"
```

---

### Task 3: Pure domain — `computeCorrelation()`

**Files:**
- Create: `lib/domain/correlations.ts`
- Create: `lib/domain/correlations.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/domain/correlations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeCorrelation, CO_FACTOR_DEFS, type DailyPair, type CorrelationConfig } from "@/lib/domain/correlations";

const cfg: CorrelationConfig = {
  primaryMetric: "glucose",
  coFactorMetric: "sleep_duration",
  splitThreshold: 6,
  splitLabel: "6h sleep",
  windowDays: 30,
};

function makePairs(below: number[], above: number[], glucoseBelow: number, glucoseAbove: number): DailyPair[] {
  let day = 1;
  const pairs: DailyPair[] = [];
  for (const _ of below) {
    pairs.push({ date: `2026-06-${String(day++).padStart(2, "0")}`, primaryValue: glucoseBelow, coFactorValue: 5 });
  }
  for (const _ of above) {
    pairs.push({ date: `2026-06-${String(day++).padStart(2, "0")}`, primaryValue: glucoseAbove, coFactorValue: 7 });
  }
  return pairs;
}

describe("computeCorrelation", () => {
  it("returns significant when deltaPct ≥ 10% and sampleCount ≥ 14 with ≥ 4 per bucket", () => {
    const pairs = makePairs(Array(8).fill(0), Array(8).fill(0), 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(true);
    expect(result.sampleCount).toBe(16);
    expect(result.primaryWhenBelow).toBe(7.8);
    expect(result.primaryWhenAbove).toBe(6.2);
  });

  it("returns not significant when sampleCount < 14", () => {
    const pairs = makePairs(Array(5).fill(0), Array(5).fill(0), 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("returns not significant when deltaPct < 10%", () => {
    const pairs = makePairs(Array(8).fill(0), Array(8).fill(0), 6.5, 6.3);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("returns not significant when a bucket has < 4 points", () => {
    const pairs = makePairs(Array(2).fill(0), Array(12).fill(0), 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.significant).toBe(false);
  });

  it("renders a narrative string", () => {
    const pairs = makePairs(Array(8).fill(0), Array(8).fill(0), 7.8, 6.2);
    const result = computeCorrelation(cfg, pairs);
    expect(result.narrative).toContain("7.8");
    expect(result.narrative).toContain("6.2");
    expect(result.narrative).toContain("16");
  });

  it("correctly computes deltaPct as absolute percentage difference", () => {
    const pairs = makePairs(Array(8).fill(0), Array(8).fill(0), 7.0, 6.0);
    const result = computeCorrelation(cfg, pairs);
    expect(result.deltaPct).toBeCloseTo(16.7, 0);
  });

  it("CO_FACTOR_DEFS has 8 entries", () => {
    expect(CO_FACTOR_DEFS).toHaveLength(8);
  });

  it("handles empty pairs gracefully", () => {
    const result = computeCorrelation(cfg, []);
    expect(result.significant).toBe(false);
    expect(result.sampleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/domain/correlations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeCorrelation()`**

Create `lib/domain/correlations.ts`:

```typescript
export interface DailyPair {
  date: string;
  primaryValue: number;
  coFactorValue: number;
}

export interface CorrelationConfig {
  primaryMetric: string;
  coFactorMetric: string;
  splitThreshold: number;
  splitLabel: string;
  windowDays: number;
}

export interface ComputedCorrelation {
  primaryMetric: string;
  coFactorMetric: string;
  windowDays: number;
  sampleCount: number;
  splitThreshold: number;
  splitLabel: string;
  primaryWhenBelow: number | null;
  primaryWhenAbove: number | null;
  countBelow: number;
  countAbove: number;
  deltaAbs: number | null;
  deltaPct: number | null;
  significant: boolean;
  narrative: string;
  evidence: Record<string, unknown>;
}

export interface CoFactorDef {
  metric: string;
  label: string;
  threshold: number | "median";
}

export const CO_FACTOR_DEFS: CoFactorDef[] = [
  { metric: "sleep_duration", label: "6h sleep", threshold: 6 },
  { metric: "sleep_score", label: "60 sleep score", threshold: 60 },
  { metric: "steps", label: "7k steps", threshold: 7000 },
  { metric: "intensity_minutes", label: "15 intensity min", threshold: 15 },
  { metric: "hrv", label: "median HRV", threshold: "median" },
  { metric: "resting_heart_rate", label: "median RHR", threshold: "median" },
  { metric: "body_battery", label: "50 body battery", threshold: 50 },
  { metric: "training_readiness", label: "40 readiness", threshold: 40 },
];

const MIN_SAMPLE_COUNT = 14;
const MIN_BUCKET_SIZE = 4;
const SIGNIFICANT_DELTA_PCT = 10;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function computeCorrelation(config: CorrelationConfig, pairs: DailyPair[]): ComputedCorrelation {
  const { primaryMetric, coFactorMetric, splitThreshold, splitLabel, windowDays } = config;

  const below = pairs.filter((p) => p.coFactorValue < splitThreshold);
  const above = pairs.filter((p) => p.coFactorValue >= splitThreshold);

  const countBelow = below.length;
  const countAbove = above.length;
  const sampleCount = pairs.length;

  const primaryWhenBelow = countBelow > 0 ? round(avg(below.map((p) => p.primaryValue))) : null;
  const primaryWhenAbove = countAbove > 0 ? round(avg(above.map((p) => p.primaryValue))) : null;

  let deltaAbs: number | null = null;
  let deltaPct: number | null = null;
  if (primaryWhenBelow !== null && primaryWhenAbove !== null) {
    deltaAbs = round(Math.abs(primaryWhenBelow - primaryWhenAbove));
    const baseline = Math.min(primaryWhenBelow, primaryWhenAbove);
    deltaPct = baseline > 0 ? round((deltaAbs / baseline) * 100, 1) : null;
  }

  const significant =
    sampleCount >= MIN_SAMPLE_COUNT &&
    countBelow >= MIN_BUCKET_SIZE &&
    countAbove >= MIN_BUCKET_SIZE &&
    deltaPct !== null &&
    deltaPct >= SIGNIFICANT_DELTA_PCT;

  const higherSide = (primaryWhenBelow ?? 0) > (primaryWhenAbove ?? 0) ? "below" : "above";
  const higherVal = higherSide === "below" ? primaryWhenBelow : primaryWhenAbove;
  const lowerVal = higherSide === "below" ? primaryWhenAbove : primaryWhenBelow;
  const narrative =
    primaryWhenBelow !== null && primaryWhenAbove !== null
      ? `Glucose avg ${higherVal} when ${coFactorMetric.replace(/_/g, " ")} ${higherSide === "below" ? "<" : "≥"} ${splitThreshold} vs ${lowerVal} ${higherSide === "below" ? "≥" : "<"} ${splitThreshold} (${deltaPct !== null ? `${deltaPct}% difference` : "—"}, ${sampleCount} data points)`
      : `Insufficient data for ${coFactorMetric.replace(/_/g, " ")} correlation (${sampleCount} data points)`;

  return {
    primaryMetric,
    coFactorMetric,
    windowDays,
    sampleCount,
    splitThreshold,
    splitLabel,
    primaryWhenBelow,
    primaryWhenAbove,
    countBelow,
    countAbove,
    deltaAbs,
    deltaPct,
    significant,
    narrative,
    evidence: {
      splitThreshold,
      countBelow,
      countAbove,
      primaryWhenBelow,
      primaryWhenAbove,
      dates: pairs.map((p) => p.date),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test lib/domain/correlations.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/correlations.ts lib/domain/correlations.test.ts
git commit -m "feat(domain): pure computeCorrelation function with threshold-split analysis"
```

---

### Task 4: DB layer — trends store

**Files:**
- Create: `lib/db/trends.ts`

- [ ] **Step 1: Implement `getDailyMetricAverages()`, `getTrends()`, `computeAndStoreTrends()`**

Create `lib/db/trends.ts`:

```typescript
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observation, dailyTrend } from "@/lib/db/schema";
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

    const [existing] = await db
      .select({ id: dailyTrend.id })
      .from(dailyTrend)
      .where(and(eq(dailyTrend.userId, userId), eq(dailyTrend.date, date), eq(dailyTrend.metric, metric)))
      .limit(1);

    if (existing) {
      await db.update(dailyTrend).set(row).where(eq(dailyTrend.id, existing.id));
    } else {
      await db.insert(dailyTrend).values({ userId, date, metric, ...row });
    }
    count++;
  }
  return count;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/trends.ts
git commit -m "feat(db): trend store — getDailyMetricAverages, getTrends, computeAndStoreTrends"
```

---

### Task 5: DB layer — correlations store

**Files:**
- Create: `lib/db/correlations.ts`

- [ ] **Step 1: Implement `getCorrelations()`, `computeAndStoreCorrelations()`**

Create `lib/db/correlations.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/correlations.ts
git commit -m "feat(db): correlation store — getCorrelations, computeAndStoreCorrelations"
```

---

### Task 6: New insight rules

**Files:**
- Modify: `lib/domain/insights.ts`
- Modify: `lib/domain/insights.test.ts`
- Modify: `lib/db/insights.ts`

- [ ] **Step 1: Write failing tests for new insight rules**

Add to the end of `lib/domain/insights.test.ts`:

```typescript
import type { ComputedTrend } from "@/lib/domain/trends";
import type { ComputedCorrelation } from "@/lib/domain/correlations";

const trend = (metric: string, direction: "rising" | "falling" | "stable", streak: number, delta7dPct: number): ComputedTrend => ({
  metric, value: 7, baseline7d: 6.5, baseline30d: 6.5, delta7dPct, delta30dPct: delta7dPct, direction, streak, sampleCount7d: 7, sampleCount30d: 14,
});

const corr = (coFactor: string, significant: boolean, deltaPct: number): ComputedCorrelation => ({
  primaryMetric: "glucose", coFactorMetric: coFactor, windowDays: 30, sampleCount: 20, splitThreshold: 6,
  splitLabel: "6h", primaryWhenBelow: 7.8, primaryWhenAbove: 6.2, countBelow: 10, countAbove: 10,
  deltaAbs: 1.6, deltaPct, significant, narrative: "test narrative", evidence: {},
});

describe("computeInsights — trend + correlation rules", () => {
  it("flags glucose_sleep_correlation when sleep correlation is significant", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      correlations: [corr("sleep_duration", true, 26)],
    });
    expect(result.find((i) => i.insightType === "glucose_sleep_correlation")).toBeDefined();
  });

  it("does NOT flag glucose_sleep_correlation when not significant", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      correlations: [corr("sleep_duration", false, 5)],
    });
    expect(result.find((i) => i.insightType === "glucose_sleep_correlation")).toBeUndefined();
  });

  it("flags glucose_activity_correlation for significant steps correlation", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      correlations: [corr("steps", true, 12)],
    });
    expect(result.find((i) => i.insightType === "glucose_activity_correlation")).toBeDefined();
  });

  it("flags glucose_recovery_correlation for significant HRV correlation", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      correlations: [corr("hrv", true, 15)],
    });
    expect(result.find((i) => i.insightType === "glucose_recovery_correlation")).toBeDefined();
  });

  it("flags trending_metric for a 5+ day streak", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      trends: [trend("glucose", "rising", 5, 10)],
    });
    expect(result.find((i) => i.insightType === "trending_metric")).toBeDefined();
  });

  it("does NOT flag trending_metric for streak < 5", () => {
    const result = computeInsights({
      observations: [], timelineEvents: [],
      trends: [trend("glucose", "rising", 3, 10)],
    });
    expect(result.find((i) => i.insightType === "trending_metric")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test lib/domain/insights.test.ts`
Expected: FAIL — `correlations` and `trends` not valid on `InsightInput`.

- [ ] **Step 3: Extend `InsightInput` and add new rules**

In `lib/domain/insights.ts`, add imports and extend the types:

At the top, add imports:
```typescript
import type { ComputedTrend } from "@/lib/domain/trends";
import type { ComputedCorrelation } from "@/lib/domain/correlations";
```

Extend `InsightInput`:
```typescript
export interface InsightInput {
  observations: InsightObservation[];
  timelineEvents: InsightEvent[];
  baseline?: Record<string, MetricBaseline>;
  trends?: ComputedTrend[];
  correlations?: ComputedCorrelation[];
}
```

Add at the end of `computeInsights()`, before the final `return out;`:

```typescript
  // --- Correlation-derived insight rules ---
  const SLEEP_METRICS = ["sleep_duration", "sleep_score"];
  const ACTIVITY_METRICS = ["steps", "intensity_minutes"];
  const RECOVERY_METRICS = ["hrv", "resting_heart_rate", "body_battery", "training_readiness"];

  if (input.correlations) {
    const sigSleep = input.correlations.find((c) => SLEEP_METRICS.includes(c.coFactorMetric) && c.significant);
    if (sigSleep) {
      out.push({
        insightType: "glucose_sleep_correlation",
        severity: "notice",
        title: "Sleep driving glucose pattern",
        summary: sigSleep.narrative,
        sourceObservationIds: [],
        sourceTimelineEventIds: [],
        evidence: { coFactor: sigSleep.coFactorMetric, deltaPct: sigSleep.deltaPct, sampleCount: sigSleep.sampleCount },
      });
    }

    const sigActivity = input.correlations.find((c) => ACTIVITY_METRICS.includes(c.coFactorMetric) && c.significant);
    if (sigActivity) {
      out.push({
        insightType: "glucose_activity_correlation",
        severity: "notice",
        title: "Activity helps glucose",
        summary: sigActivity.narrative,
        sourceObservationIds: [],
        sourceTimelineEventIds: [],
        evidence: { coFactor: sigActivity.coFactorMetric, deltaPct: sigActivity.deltaPct, sampleCount: sigActivity.sampleCount },
      });
    }

    const sigRecovery = input.correlations.find((c) => RECOVERY_METRICS.includes(c.coFactorMetric) && c.significant);
    if (sigRecovery) {
      out.push({
        insightType: "glucose_recovery_correlation",
        severity: "notice",
        title: "Recovery linked to glucose",
        summary: sigRecovery.narrative,
        sourceObservationIds: [],
        sourceTimelineEventIds: [],
        evidence: { coFactor: sigRecovery.coFactorMetric, deltaPct: sigRecovery.deltaPct, sampleCount: sigRecovery.sampleCount },
      });
    }
  }

  // --- Trending metric rule ---
  if (input.trends) {
    const longStreak = input.trends.find((t) => t.streak >= 5 && t.direction !== "stable");
    if (longStreak) {
      const dir = longStreak.direction === "rising" ? "up" : "down";
      out.push({
        insightType: "trending_metric",
        severity: "info",
        title: `${longStreak.metric.replace(/_/g, " ")} trending ${dir}`,
        summary: `${longStreak.metric.replace(/_/g, " ")} has been ${longStreak.direction} for ${longStreak.streak} consecutive days (${longStreak.delta7dPct !== null ? `${longStreak.delta7dPct}%` : ""} vs 7d baseline).`,
        sourceObservationIds: [],
        sourceTimelineEventIds: [],
        evidence: { metric: longStreak.metric, direction: longStreak.direction, streak: longStreak.streak, delta7dPct: longStreak.delta7dPct },
      });
    }
  }
```

- [ ] **Step 4: Update `computeAndStoreInsights` to pass trends + correlations**

In `lib/db/insights.ts`, add imports at top:

```typescript
import { getTrends } from "@/lib/db/trends";
import { getCorrelations } from "@/lib/db/correlations";
import type { ComputedTrend } from "@/lib/domain/trends";
import type { ComputedCorrelation } from "@/lib/domain/correlations";
```

In `computeAndStoreInsights()`, after the `const baseline = await getBaseline(...)` line, add:

```typescript
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
```

Then update the `computeInsights()` call to include them:

```typescript
  const computed = computeInsights({
    observations: observations.map((o) => ({ id: o.id, metric: o.metric, value: o.value, observedAt: o.observedAt })),
    timelineEvents: events.map((e) => ({ id: e.id, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata })),
    baseline,
    trends,
    correlations,
  });
```

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: All pass including new insight tests.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/insights.ts lib/domain/insights.test.ts lib/db/insights.ts
git commit -m "feat(insights): add correlation-derived + trending metric insight rules"
```

---

### Task 7: Pipeline — Inngest + API routes + cron

**Files:**
- Modify: `lib/inngest/functions.ts`
- Create: `app/api/jobs/trends/route.ts`
- Create: `app/api/jobs/correlations/route.ts`
- Modify: `.github/workflows/daily-refresh.yml`

- [ ] **Step 1: Add Inngest functions**

In `lib/inngest/functions.ts`, add imports:

```typescript
import { computeAndStoreTrends } from "@/lib/db/trends";
import { computeAndStoreCorrelations } from "@/lib/db/correlations";
```

Add after the `dailySnapshot` function:

```typescript
export const dailyTrends = inngest.createFunction(
  { id: "daily-trends" },
  [{ event: "trends/recompute.requested" }, { cron: "5 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreTrends(SEED_USER_ID, date),
    );
    return { date, count };
  },
);

export const dailyCorrelations = inngest.createFunction(
  { id: "daily-correlations" },
  [{ event: "correlations/recompute.requested" }, { cron: "10 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreCorrelations(SEED_USER_ID, date),
    );
    return { date, count };
  },
);
```

Update the exported functions array:

```typescript
export const functions = [dailySnapshot, dailyTrends, dailyCorrelations, insights];
```

- [ ] **Step 2: Create API route for trends**

Create `app/api/jobs/trends/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { dayRange } from "@/lib/domain/time";
import { computeAndStoreTrends } from "@/lib/db/trends";
import { SEED_USER_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const count = await computeAndStoreTrends(SEED_USER_ID, date);
  return NextResponse.json({ ok: true, date, count });
}
```

- [ ] **Step 3: Create API route for correlations**

Create `app/api/jobs/correlations/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { dayRange } from "@/lib/domain/time";
import { computeAndStoreCorrelations } from "@/lib/db/correlations";
import { SEED_USER_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const count = await computeAndStoreCorrelations(SEED_USER_ID, date);
  return NextResponse.json({ ok: true, date, count });
}
```

- [ ] **Step 4: Update daily-refresh workflow**

In `.github/workflows/daily-refresh.yml`, update the `run:` block to add trend and correlation steps between snapshot and insights:

```yaml
        run: |
          set -uo pipefail

          echo "→ Garmin sync"
          curl -fsS -m 300 -X POST "$APP_URL/api/sources/$GARMIN_CONNECTION_ID/sync" || echo "  (garmin sync failed — continuing)"

          for d in "$(date -u +%F)" "$(date -u -d 'yesterday' +%F)"; do
            echo "→ recompute $d"
            curl -fsS -m 120 -X POST "$APP_URL/api/jobs/daily-snapshot?date=$d"  || echo "  (snapshot $d failed)"
            curl -fsS -m 120 -X POST "$APP_URL/api/jobs/trends?date=$d"          || echo "  (trends $d failed)"
            curl -fsS -m 120 -X POST "$APP_URL/api/jobs/correlations?date=$d"    || echo "  (correlations $d failed)"
            curl -fsS -m 120 -X POST "$APP_URL/api/jobs/insights?date=$d"        || echo "  (insights $d failed)"
          done

          echo "Done."
```

- [ ] **Step 5: Verify build**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/inngest/functions.ts app/api/jobs/trends/ app/api/jobs/correlations/ .github/workflows/daily-refresh.yml
git commit -m "feat(pipeline): add trend + correlation job steps, API routes, cron"
```

---

### Task 8: /today page redesign

**Files:**
- Rewrite: `app/today/page.tsx`
- Delete: `components/today/StateCard.tsx`

- [ ] **Step 1: Rewrite `app/today/page.tsx`**

Replace entire contents of `app/today/page.tsx`:

```tsx
import Link from "next/link";
import { getInsights } from "@/lib/db/insights";
import { getDailySnapshot } from "@/lib/db/snapshots";
import { getTrends } from "@/lib/db/trends";
import { getCorrelations } from "@/lib/db/correlations";
import { getTimeline } from "@/lib/db/store";
import { serializeInsights } from "@/lib/api/insight-dto";
import { computeDailySnapshot, type GlucoseSummary } from "@/lib/domain/snapshot";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import type { TrendDirection } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function deltaColor(pct: number | null, invert = false): string {
  if (pct === null) return "text-zinc-500";
  const bad = invert ? pct < -3 : pct > 3;
  const good = invert ? pct > 3 : pct < -3;
  if (bad) return "text-amber-400";
  if (good) return "text-emerald-400";
  return "text-zinc-500";
}

function dirArrow(d: TrendDirection): string {
  if (d === "rising") return "▲";
  if (d === "falling") return "▼";
  return "→";
}

const INVERT_METRICS = new Set(["sleep_duration", "sleep_score", "steps", "intensity_minutes", "hrv", "body_battery", "training_readiness"]);

interface TrendRow {
  metric: string;
  value: number;
  delta30dPct: number | null;
  direction: string;
  streak: number;
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "sleep_duration") return `${(value / 3600).toFixed(1)}h`;
  if (metric === "steps") return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
  if (metric === "hrv") return `${Math.round(value)}ms`;
  if (metric === "resting_heart_rate") return `${Math.round(value)}`;
  return String(Math.round(value));
}

function metricLabel(m: string): string {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function narrativeSeverity(t: TrendRow): string {
  if (t.direction !== "stable" && Math.abs(t.delta30dPct ?? 0) > 10) return "border-l-amber-400";
  if (t.direction === "falling" && INVERT_METRICS.has(t.metric)) return "border-l-amber-400";
  if (t.direction === "rising" && INVERT_METRICS.has(t.metric)) return "border-l-emerald-400";
  return "border-l-zinc-700";
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: rawDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let date = rawDate ?? today;
  try { dayRange(date); } catch { date = today; }

  const [snapshot, trends, correlations, insightRows, { events, observations }] = await Promise.all([
    getDailySnapshot(SEED_USER_ID, date),
    getTrends(SEED_USER_ID, date),
    getCorrelations(SEED_USER_ID, date),
    getInsights(SEED_USER_ID, date),
    getTimeline(SEED_USER_ID, date),
  ]);

  const summary = snapshot
    ? (snapshot.summaryJson as { glucose?: GlucoseSummary })
    : computeDailySnapshot({
        observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
        timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
      });

  const allInsights = serializeInsights(insightRows);
  const glucoseTrend = trends.find((t) => t.metric === "glucose");
  const vitalTrends = trends.filter((t) => t.metric !== "glucose");
  const sigCorrelations = correlations.filter((c) => c.significant === 1);
  const pendingCorrelations = correlations.filter((c) => c.significant === 0);

  const annotations = events
    .filter((e) => e.sourceType === "manual")
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const recoveryMetrics = ["training_readiness", "body_battery", "sleep_score", "hrv"];
  const recoveryTrends = recoveryMetrics
    .map((m) => trends.find((t) => t.metric === m))
    .filter(Boolean) as typeof trends;

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-4 font-mono text-xs text-zinc-300">
      {/* Header */}
      <header className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-2">
        <h1 className="text-base font-semibold text-zinc-200">/today</h1>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <nav className="flex items-center gap-1">
            <Link href={`/today?date=${shiftDate(date, -1)}`} className="rounded border border-zinc-800 px-1.5 py-0.5 hover:bg-zinc-800">←</Link>
            <span className="tabular-nums">{date}</span>
            <Link href={`/today?date=${shiftDate(date, 1)}`} className="rounded border border-zinc-800 px-1.5 py-0.5 hover:bg-zinc-800">→</Link>
          </nav>
          <span>{trends.length} metrics · {correlations.length} correlations</span>
        </div>
      </header>

      {/* 3-column grid */}
      <div className="grid grid-cols-[320px_1fr_340px] gap-4" style={{ minHeight: "calc(100vh - 80px)" }}>

        {/* LEFT — Glucose hero + Vitals */}
        <div className="flex flex-col gap-3">
          {/* Glucose Hero */}
          <div className="rounded-md border border-violet-500/30 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Glucose</span>
              {glucoseTrend && (
                <span className="text-[10px] text-zinc-500">
                  {dirArrow(glucoseTrend.direction as TrendDirection)} {glucoseTrend.direction} {glucoseTrend.streak > 0 && `${glucoseTrend.streak}d`}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-zinc-200">{summary.glucose?.average ?? "—"}</span>
              <span className="text-[11px] text-zinc-500">mmol/L avg</span>
              {glucoseTrend?.delta7dPct != null && (
                <span className={`text-[11px] ${deltaColor(glucoseTrend.delta7dPct)}`}>
                  {glucoseTrend.delta7dPct > 0 ? "+" : ""}{glucoseTrend.delta7dPct}% vs 7d
                </span>
              )}
              {glucoseTrend?.delta30dPct != null && (
                <span className="text-[11px] text-zinc-600">
                  {glucoseTrend.delta30dPct > 0 ? "+" : ""}{glucoseTrend.delta30dPct}% vs 30d
                </span>
              )}
            </div>
            {summary.glucose && (
              <div className="mt-2 grid grid-cols-4 gap-2 border-t border-zinc-800 pt-2">
                <div><div className="text-[9px] uppercase text-zinc-600">Min</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.min}</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">Max</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.max}</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">TIR</div><div className="text-sm font-semibold text-zinc-200">{Math.round((summary.glucose.estimatedTimeInRange ?? 0) * 100)}%</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">σ</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.variability}</div></div>
              </div>
            )}
          </div>

          {/* Vitals Table */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Vitals & Activity</div>
            <div className="mt-2 space-y-0">
              {vitalTrends.length === 0 && <p className="text-zinc-600">Awaiting data…</p>}
              {vitalTrends.map((t) => (
                <div key={t.metric} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-[#0a0a0f] px-1 py-1.5 hover:bg-[#1a1a2e]">
                  <span className="truncate text-zinc-400">{metricLabel(t.metric)}</span>
                  <span className="font-semibold tabular-nums text-zinc-200">{formatMetricValue(t.metric, t.value)}</span>
                  <span className={`min-w-[48px] text-right tabular-nums ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {t.delta30dPct !== null ? `${t.delta30dPct > 0 ? "+" : ""}${t.delta30dPct}%` : "—"}
                  </span>
                  <span className="min-w-[40px] text-right text-zinc-500">
                    {dirArrow(t.direction as TrendDirection)} {t.streak > 0 ? `${t.streak}d` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER — Trends + Correlations */}
        <div className="flex flex-col gap-3">
          {/* Trend Narratives */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Trend Narratives</span>
              <span className="text-[9px] text-zinc-600">7d + 30d baselines</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {trends.length === 0 && <p className="text-zinc-600">Awaiting data…</p>}
              {trends.map((t) => {
                const dir = t.direction === "rising" ? "up" : t.direction === "falling" ? "down" : "stable at";
                const pct = t.delta7dPct !== null ? `${Math.abs(t.delta7dPct)}%` : "";
                const baseline = t.baseline7d !== null ? `${t.baseline7d}` : "";
                const streakNote = t.streak > 0 ? ` — ${t.direction} ${t.streak} consecutive days` : "";
                return (
                  <div key={t.metric} className={`border-l-2 ${narrativeSeverity(t)} py-1.5 pl-3 leading-relaxed text-zinc-300`}>
                    {metricLabel(t.metric)} {formatMetricValue(t.metric, t.value)}, {dir} {pct} from 7d baseline{baseline ? ` of ${baseline}` : ""}{streakNote}.
                  </div>
                );
              })}
            </div>
          </div>

          {/* Correlations */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Glucose Correlations</span>
              <span className="text-[9px] text-zinc-600">30d · min 14 data points</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {correlations.length === 0 && <p className="col-span-2 text-zinc-600">Awaiting data…</p>}
              {[...sigCorrelations, ...pendingCorrelations].map((c) => (
                <div key={c.coFactorMetric} className={`rounded border ${c.significant === 1 ? "border-amber-500/30" : "border-zinc-800"} bg-[#0a0a0f] p-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-violet-300">{metricLabel(c.coFactorMetric)} → Glucose</span>
                    <span className={`text-[9px] rounded px-1.5 py-0.5 ${c.significant === 1 ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-500"}`}>
                      {c.significant === 1 ? "significant" : c.sampleCount >= 14 ? "not significant" : `${c.sampleCount}/14`}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="rounded bg-[#111118] p-2 text-center">
                      <span className="block text-[9px] text-zinc-500">&lt; {c.splitThreshold} {c.splitLabel}</span>
                      <span className="block text-lg font-bold text-zinc-200">{c.primaryWhenBelow?.toFixed(1) ?? "—"}</span>
                      <span className="block text-[9px] text-zinc-500">mmol/L</span>
                    </div>
                    <div className="rounded bg-[#111118] p-2 text-center">
                      <span className="block text-[9px] text-zinc-500">≥ {c.splitThreshold} {c.splitLabel}</span>
                      <span className="block text-lg font-bold text-zinc-200">{c.primaryWhenAbove?.toFixed(1) ?? "—"}</span>
                      <span className="block text-[9px] text-zinc-500">mmol/L</span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">{c.narrative}</p>
                  <p className="mt-1 text-[9px] text-zinc-600">n={c.sampleCount} · Δ {c.deltaAbs?.toFixed(1) ?? "—"} mmol/L</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Recovery + Insights + Log */}
        <div className="flex flex-col gap-3">
          {/* Recovery Snapshot */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Recovery Snapshot</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {recoveryTrends.length === 0 && <p className="col-span-2 text-zinc-600">Awaiting data…</p>}
              {recoveryTrends.map((t) => (
                <div key={t.metric} className="rounded bg-[#0a0a0f] p-2.5 text-center">
                  <div className="text-[9px] uppercase text-zinc-600">{metricLabel(t.metric)}</div>
                  <div className={`text-xl font-bold ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {formatMetricValue(t.metric, t.value)}
                  </div>
                  <div className={`text-[10px] ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {dirArrow(t.direction as TrendDirection)} {t.delta30dPct !== null ? `${t.delta30dPct > 0 ? "+" : ""}${t.delta30dPct}% vs 30d` : "—"}
                  </div>
                  {t.streak > 0 && <div className="text-[9px] text-zinc-600">{t.streak}d {t.direction}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Insights */}
          <div className="flex-1 rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Insights</span>
              <span className="text-[9px] text-zinc-600">{allInsights.length} active</span>
            </div>
            <div className="mt-2 space-y-0">
              {allInsights.length === 0 && <p className="text-zinc-600">No insights for this day.</p>}
              {allInsights.map((i) => {
                const dotColor = i.severity === "critical" ? "bg-red-500" : i.severity === "warning" ? "bg-amber-500" : i.severity === "notice" ? "bg-blue-400" : "bg-zinc-500";
                return (
                  <div key={i.id} className="grid grid-cols-[6px_1fr] gap-2 border-b border-[#0a0a0f] py-1.5">
                    <div className={`mt-1.5 h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    <div>
                      <div className="font-mono text-[9px] text-zinc-600">{i.insightType}</div>
                      <div className="text-[11px] text-zinc-300">{i.title}</div>
                      <div className="text-[10px] text-zinc-500">{i.summary}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {allInsights.length > 0 && (
              <Link href={`/insights?date=${date}`} className="mt-2 block text-[10px] text-zinc-500 underline underline-offset-2">all insights →</Link>
            )}
          </div>

          {/* Today's Log */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Today's Log</div>
            <div className="mt-2 space-y-0">
              {annotations.length === 0 && <p className="text-zinc-600">No annotations.</p>}
              {annotations.map((e) => (
                <div key={e.id} className="grid grid-cols-[50px_60px_1fr] gap-2 border-b border-[#0a0a0f] py-1 text-[11px]">
                  <span className="text-zinc-600">{e.startedAt.toISOString().slice(11, 16)}</span>
                  <span className="font-medium text-violet-300">{(e.metadata as { annotationType?: string })?.annotationType ?? e.eventType}</span>
                  <span className="text-zinc-300">{e.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Delete `StateCard` component**

Delete `components/today/StateCard.tsx` — no longer used.

- [ ] **Step 3: Verify build**

Run: `pnpm exec tsc --noEmit`
Expected: No type errors. (If `GlucoseSummary` is not exported from snapshot.ts, add the export.)

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: All pass. (The page is a server component — no unit tests, verified visually.)

- [ ] **Step 5: Commit**

```bash
git add app/today/page.tsx
git rm components/today/StateCard.tsx
git commit -m "feat(today): 3-column data-dense health briefing with trends + correlations"
```

- [ ] **Step 6: Visual verification**

Run: `pnpm dev`
Open `http://localhost:3000/today` and verify:
- 3-column layout renders
- Glucose hero shows (or "—" if no data yet)
- Vitals table shows "Awaiting data…" (new user, no trends computed yet)
- Correlations show "Awaiting data…"
- Insights list renders
- Date navigation works
