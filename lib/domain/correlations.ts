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
