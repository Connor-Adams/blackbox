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
  const cutoff30d = daysAgo(today, 30);
  const last7d = sorted.filter((d) => d.date >= cutoff7d && d.date < today);
  const last30d = sorted.filter((d) => d.date >= cutoff30d && d.date < today);

  const baseline7d = last7d.length >= MIN_SAMPLES_7D ? round(avg(last7d.map((d) => d.value))) : null;
  const baseline30d = last30d.length >= MIN_SAMPLES_30D ? round(avg(last30d.map((d) => d.value))) : null;

  const delta7dPct =
    baseline7d !== null && baseline7d !== 0
      ? round(((todayValue - baseline7d) / baseline7d) * 100, 1)
      : null;
  const delta30dPct =
    baseline30d !== null && baseline30d !== 0
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
