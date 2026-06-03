export interface GlucoseSummary {
  readingCount: number;
  average: number;
  min: number;
  max: number;
  variability: number;
  estimatedTimeInRange?: number;
}

export interface FinanceSummary {
  spendTotal: number;
  transactionCount: number;
  largestTransaction?: number;
}

export interface AnnotationsSummary {
  count: number;
  types: Record<string, number>;
}

export interface DailySnapshotSummary {
  glucose?: GlucoseSummary;
  finance?: FinanceSummary;
  annotations?: AnnotationsSummary;
}

export interface SnapshotInput {
  observations: { metric: string; value: number }[];
  timelineEvents: { sourceType: string; metadata: Record<string, unknown> }[];
}

const TIR_LOW = 3.9;
const TIR_HIGH = 10.0;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic daily rollup. Sections present only when there is data. Pure. */
export function computeDailySnapshot(input: SnapshotInput): DailySnapshotSummary {
  const summary: DailySnapshotSummary = {};

  const glucose = input.observations.filter((o) => o.metric === "glucose").map((o) => o.value);
  if (glucose.length > 0) {
    const n = glucose.length;
    const average = glucose.reduce((a, b) => a + b, 0) / n;
    const variance = glucose.reduce((a, b) => a + (b - average) ** 2, 0) / n;
    const inRange = glucose.filter((v) => v >= TIR_LOW && v <= TIR_HIGH).length;
    summary.glucose = {
      readingCount: n,
      average: round(average),
      min: round(Math.min(...glucose)),
      max: round(Math.max(...glucose)),
      variability: round(Math.sqrt(variance)),
      estimatedTimeInRange: round(inRange / n, 3),
    };
  }

  const tx = input.observations.filter((o) => o.metric === "transaction_amount").map((o) => o.value);
  if (tx.length > 0) {
    summary.finance = {
      spendTotal: round(tx.reduce((a, b) => a + b, 0)),
      transactionCount: tx.length,
      largestTransaction: round(Math.max(...tx)),
    };
  }

  const manual = input.timelineEvents.filter((e) => e.sourceType === "manual");
  if (manual.length > 0) {
    const types: Record<string, number> = {};
    for (const e of manual) {
      const t = typeof e.metadata.annotationType === "string" ? e.metadata.annotationType : "unknown";
      types[t] = (types[t] ?? 0) + 1;
    }
    summary.annotations = { count: manual.length, types };
  }

  return summary;
}
