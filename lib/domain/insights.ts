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
export interface InsightInput { observations: InsightObservation[]; timelineEvents: InsightEvent[]; }

const VOLATILITY = 3.0;
const HIGH = 13.0;
const LOW = 3.9;
const CONTEXT_WINDOW_MS = 90 * 60 * 1000;
const HIGH_SPEND = 200;
const HIGH_TX_COUNT = 20;

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

  return out;
}
