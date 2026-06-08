import type { InsightSeverity } from "@/lib/db/schema";

export interface ComputedInsight {
  insightType: string;
  severity: InsightSeverity;
  title: string;
  summary: string;
  sourceObservationIds: string[];
  sourceTimelineEventIds: string[];
  evidence: Record<string, unknown>;
}

export interface InsightObservation { id: string; metric: string; value: number; observedAt: Date; }
export interface InsightEvent { id: string; sourceType: string; eventType: string; startedAt: Date; metadata: Record<string, unknown>; }
/** Trailing per-metric daily baseline (mean/stddev over the last N days). */
export interface MetricBaseline { mean: number; stddev: number; n: number }
export interface InsightInput {
  observations: InsightObservation[];
  timelineEvents: InsightEvent[];
  baseline?: Record<string, MetricBaseline>;
}

const VOLATILITY = 3.0;
const HIGH = 13.0;
const LOW = 3.9;
const CONTEXT_WINDOW_MS = 90 * 60 * 1000;
const HIGH_SPEND = 200;
const HIGH_TX_COUNT = 20;

// Garmin recovery / wellness thresholds.
const LOW_READINESS = 25;
const POOR_SLEEP_SCORE = 50;
const SHORT_SLEEP_S = 6 * 3600;
const LOW_BATTERY_PEAK = 50;
const HIGH_STRESS_AVG = 50;
const SEDENTARY_STEPS = 4000;
const MIN_BASELINE_DAYS = 5;
const RHR_MIN_DELTA = 5;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic, inspectable insight rules over one day's normalized data.
 *  Pure. At most one insight per insightType (so persistence can upsert on
 *  (userId, date, insightType)). */
export function computeInsights(input: InsightInput): ComputedInsight[] {
  const out: ComputedInsight[] = [];
  const glucose = input.observations.filter((o) => o.metric === "glucose");

  if (glucose.length >= 2) {
    const vals = glucose.map((x) => x.value);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (stddev > VOLATILITY) {
      out.push({
        insightType: "glucose_volatility",
        severity: "warning",
        title: "Volatile glucose day",
        summary: `Glucose variability (${round(stddev)} mmol/L) exceeded the ${VOLATILITY} threshold.`,
        sourceObservationIds: glucose.map((x) => x.id),
        sourceTimelineEventIds: [],
        evidence: { stddev: round(stddev), threshold: VOLATILITY },
      });
    }
  }

  const highs = glucose.filter((x) => x.value > HIGH);
  if (highs.length > 0) {
    const max = Math.max(...highs.map((x) => x.value));
    out.push({
      insightType: "glucose_high",
      severity: "warning",
      title: "Glucose spike",
      summary: `${highs.length} reading(s) above ${HIGH} mmol/L (max ${round(max)}).`,
      sourceObservationIds: highs.map((x) => x.id),
      sourceTimelineEventIds: [],
      evidence: { count: highs.length, max: round(max), threshold: HIGH },
    });
  }

  const lows = glucose.filter((x) => x.value < LOW);
  if (lows.length > 0) {
    const min = Math.min(...lows.map((x) => x.value));
    out.push({
      insightType: "glucose_low",
      severity: "critical",
      title: "Low glucose",
      summary: `${lows.length} reading(s) below ${LOW} mmol/L (min ${round(min)}).`,
      sourceObservationIds: lows.map((x) => x.id),
      sourceTimelineEventIds: [],
      evidence: { count: lows.length, min: round(min), threshold: LOW },
    });
  }

  const context = input.timelineEvents.filter((e) => e.eventType === "meal" || e.eventType === "insulin");
  const uncovered = highs.filter(
    (spike) => !context.some((e) => Math.abs(e.startedAt.getTime() - spike.observedAt.getTime()) <= CONTEXT_WINDOW_MS),
  );
  if (uncovered.length > 0) {
    out.push({
      insightType: "spike_without_context",
      severity: "notice",
      title: "Spike(s) without logged context",
      summary: `${uncovered.length} glucose spike(s) had no meal or insulin logged within 90 minutes.`,
      sourceObservationIds: uncovered.map((x) => x.id),
      sourceTimelineEventIds: [],
      evidence: { count: uncovered.length },
    });
  }

  const tx = input.observations.filter((o) => o.metric === "transaction_amount");
  if (tx.length > 0) {
    const total = tx.reduce((a, b) => a + b.value, 0);
    if (total > HIGH_SPEND) {
      out.push({
        insightType: "high_spend",
        severity: "notice",
        title: "High spend day",
        summary: `Spending totalled $${round(total)}, above the $${HIGH_SPEND} threshold.`,
        sourceObservationIds: tx.map((t) => t.id),
        sourceTimelineEventIds: [],
        evidence: { total: round(total), threshold: HIGH_SPEND },
      });
    }
    if (tx.length > HIGH_TX_COUNT) {
      out.push({
        insightType: "high_tx_count",
        severity: "info",
        title: "Many transactions",
        summary: `${tx.length} transactions, above the ${HIGH_TX_COUNT} threshold.`,
        sourceObservationIds: tx.map((t) => t.id),
        sourceTimelineEventIds: [],
        evidence: { count: tx.length, threshold: HIGH_TX_COUNT },
      });
    }
  }

  // --- Garmin recovery + wellness rules ---
  const metric = (m: string) => input.observations.filter((o) => o.metric === m);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const latestOf = (xs: InsightObservation[]) => xs.reduce((a, b) => (b.observedAt > a.observedAt ? b : a));

  const readiness = metric("training_readiness");
  const readinessVal = readiness.length ? latestOf(readiness).value : null;
  if (readinessVal !== null && readinessVal < LOW_READINESS) {
    out.push({
      insightType: "low_recovery",
      severity: "warning",
      title: "Low recovery",
      summary: `Training readiness was ${readinessVal}/100 — your body is signalling it needs rest.`,
      sourceObservationIds: [latestOf(readiness).id],
      sourceTimelineEventIds: [],
      evidence: { readiness: readinessVal, threshold: LOW_READINESS },
    });
  }

  const sleepScore = metric("sleep_score")[0] ?? null;
  const sleepDur = metric("sleep_duration")[0] ?? null;
  const poorScore = sleepScore !== null && sleepScore.value < POOR_SLEEP_SCORE;
  const shortSleep = sleepDur !== null && sleepDur.value < SHORT_SLEEP_S;
  if (poorScore || shortSleep) {
    const ids: string[] = [];
    const parts: string[] = [];
    if (poorScore) { parts.push(`sleep score ${sleepScore!.value}/100`); ids.push(sleepScore!.id); }
    if (shortSleep) { parts.push(`${round(sleepDur!.value / 3600, 1)}h asleep`); ids.push(sleepDur!.id); }
    out.push({
      insightType: "poor_sleep",
      severity: "notice",
      title: "Poor sleep",
      summary: `${parts.join(", ")}.`,
      sourceObservationIds: ids,
      sourceTimelineEventIds: [],
      evidence: { sleepScore: sleepScore?.value ?? null, sleepHours: sleepDur ? round(sleepDur.value / 3600, 1) : null },
    });
  }

  const battery = metric("body_battery");
  if (battery.length > 0) {
    const peak = Math.max(...battery.map((x) => x.value));
    if (peak < LOW_BATTERY_PEAK) {
      const peakObs = battery.find((x) => x.value === peak)!;
      out.push({
        insightType: "body_battery_low",
        severity: "notice",
        title: "Body Battery didn't recharge",
        summary: `Body Battery peaked at only ${peak}/100 — limited overnight recovery.`,
        sourceObservationIds: [peakObs.id],
        sourceTimelineEventIds: [],
        evidence: { peak, threshold: LOW_BATTERY_PEAK },
      });
    }
  }

  const stressObs = metric("stress");
  if (stressObs.length >= 10) {
    const avgStress = round(mean(stressObs.map((x) => x.value)));
    if (avgStress > HIGH_STRESS_AVG) {
      out.push({
        insightType: "high_stress",
        severity: "notice",
        title: "High-stress day",
        summary: `Average stress ${avgStress}/100 across the day.`,
        sourceObservationIds: stressObs.map((x) => x.id),
        sourceTimelineEventIds: [],
        evidence: { avgStress, threshold: HIGH_STRESS_AVG },
      });
    }
  }

  const stepObs = metric("steps");
  if (stepObs.length > 0) {
    const total = Math.round(stepObs.reduce((a, b) => a + b.value, 0));
    if (total < SEDENTARY_STEPS) {
      out.push({
        insightType: "sedentary",
        severity: "info",
        title: "Sedentary day",
        summary: `${total.toLocaleString()} steps — below ${SEDENTARY_STEPS.toLocaleString()}.`,
        sourceObservationIds: stepObs.map((x) => x.id),
        sourceTimelineEventIds: [],
        evidence: { steps: total, threshold: SEDENTARY_STEPS },
      });
    }
  }

  // Baseline rule: resting HR meaningfully above the trailing baseline.
  const rhr = metric("resting_heart_rate")[0] ?? null;
  const rhrBase = input.baseline?.resting_heart_rate;
  if (rhr !== null && rhrBase && rhrBase.n >= MIN_BASELINE_DAYS) {
    const delta = rhr.value - rhrBase.mean;
    if (delta >= Math.max(RHR_MIN_DELTA, 2 * rhrBase.stddev)) {
      out.push({
        insightType: "resting_hr_elevated",
        severity: "warning",
        title: "Resting HR elevated",
        summary: `Resting HR ${rhr.value} bpm is ${round(delta, 1)} above your ${rhrBase.n}-day baseline (${round(rhrBase.mean, 1)}) — possible illness, alcohol, stress, or under-recovery.`,
        sourceObservationIds: [rhr.id],
        sourceTimelineEventIds: [],
        evidence: { value: rhr.value, baseline: round(rhrBase.mean, 1), delta: round(delta, 1), days: rhrBase.n },
      });
    }
  }

  // Baseline rule: overnight HRV below the trailing baseline.
  const hrvObs = metric("hrv");
  const hrvBase = input.baseline?.hrv;
  if (hrvObs.length >= 5 && hrvBase && hrvBase.n >= MIN_BASELINE_DAYS) {
    const todayHrv = mean(hrvObs.map((x) => x.value));
    if (todayHrv <= hrvBase.mean - hrvBase.stddev) {
      out.push({
        insightType: "low_hrv",
        severity: "notice",
        title: "Low HRV",
        summary: `Overnight HRV (${round(todayHrv)} ms) is below your ${hrvBase.n}-day baseline (${round(hrvBase.mean)}) — elevated stress or fatigue.`,
        sourceObservationIds: hrvObs.map((x) => x.id),
        sourceTimelineEventIds: [],
        evidence: { avg: round(todayHrv), baseline: round(hrvBase.mean), days: hrvBase.n },
      });
    }
  }

  // Cross-domain: poor sleep AND low readiness on the same day.
  if (sleepScore !== null && sleepScore.value < 55 && readinessVal !== null && readinessVal < 30) {
    out.push({
      insightType: "recovery_compromised",
      severity: "warning",
      title: "Recovery compromised",
      summary: `Poor sleep (score ${sleepScore.value}) and low training readiness (${readinessVal}) — prioritise rest today.`,
      sourceObservationIds: [sleepScore.id, latestOf(readiness).id],
      sourceTimelineEventIds: [],
      evidence: { sleepScore: sleepScore.value, readiness: readinessVal },
    });
  }

  return out;
}
