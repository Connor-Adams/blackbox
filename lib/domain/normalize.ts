import type { AnnotationType, TimelineEventType } from "@/lib/db/schema";
import type {
  CashflowTransactionPayload,
  DexcomReadingPayload,
  ManualAnnotationPayload,
  NormalizeResult,
  RawEventInput,
} from "@/lib/domain/types";

const EMPTY: NormalizeResult = { observations: [], timelineEvents: [] };

const MANUAL_EVENT_TYPE: Record<AnnotationType, TimelineEventType> = {
  meal: "meal",
  insulin: "insulin",
  travel: "travel",
  stress: "stress_event",
  note: "manual_note",
  exercise: "manual_note",
  sick: "manual_note",
  caffeine: "manual_note",
  alcohol: "manual_note",
  medication: "manual_note",
};

function normalizeManual(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as ManualAnnotationPayload;
  return {
    observations: [],
    timelineEvents: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "manual",
        eventType: MANUAL_EVENT_TYPE[p.type] ?? "manual_note",
        title: p.title,
        description: p.notes ?? null,
        startedAt: new Date(p.timestamp),
        endedAt: p.endTimestamp ? new Date(p.endTimestamp) : null,
        metadata: { annotationType: p.type, ...(p.metadata ?? {}) },
      },
    ],
  };
}

function normalizeDexcom(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as DexcomReadingPayload;
  return {
    observations: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "dexcom",
        metric: "glucose",
        value: p.value,
        unit: p.unit,
        observedAt: new Date(p.timestamp),
        metadata: {
          ...(p.trend !== undefined ? { trend: p.trend } : {}),
          ...(p.trendRate !== undefined ? { trendRate: p.trendRate } : {}),
        },
      },
    ],
    timelineEvents: [],
  };
}

function normalizeCashflow(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as CashflowTransactionPayload;
  const extra = p.category ? { category: p.category } : {};
  return {
    observations: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "cashflow",
        metric: "transaction_amount",
        value: p.amount,
        unit: "USD",
        observedAt: new Date(p.timestamp),
        metadata: { description: p.description, ...extra },
      },
    ],
    timelineEvents: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "cashflow",
        eventType: "transaction",
        title: p.description,
        description: `$${p.amount}`,
        startedAt: new Date(p.timestamp),
        endedAt: null,
        metadata: { amount: p.amount, ...extra },
      },
    ],
  };
}

/** Map a raw source payload to normalized observations + timeline events.
 *  Pure: no DB, no IO. Unsupported source types yield an empty result. */
export function normalize(raw: RawEventInput): NormalizeResult {
  switch (raw.sourceType) {
    case "manual":
      return normalizeManual(raw);
    case "dexcom":
      return normalizeDexcom(raw);
    case "cashflow":
      return normalizeCashflow(raw);
    default:
      return EMPTY;
  }
}
