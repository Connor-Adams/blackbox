import type { SourceType } from "@/lib/db/schema";

/** A raw event as seen by the pure normalizer. `userId` is resolved by the
 *  caller from the owning source connection (raw_event itself has no userId). */
export interface RawEventInput {
  id: string;
  userId: string;
  sourceConnectionId: string;
  sourceType: SourceType;
  sourceRecordId: string | null;
  occurredAt: Date;
  payload: unknown;
}

export interface NormalizedObservation {
  userId: string;
  rawEventId: string;
  sourceType: SourceType;
  metric: string;
  value: number;
  unit: string;
  observedAt: Date;
  metadata: Record<string, unknown>;
}

export interface NormalizedTimelineEvent {
  userId: string;
  rawEventId: string | null;
  sourceType: SourceType;
  eventType: string;
  title: string;
  description: string | null;
  startedAt: Date;
  endedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface NormalizeResult {
  observations: NormalizedObservation[];
  timelineEvents: NormalizedTimelineEvent[];
}

export interface ManualAnnotationPayload {
  type:
    | "note" | "meal" | "insulin" | "exercise" | "sick"
    | "travel" | "stress" | "caffeine" | "alcohol" | "medication";
  title: string;
  timestamp: string;
  endTimestamp?: string;
  notes?: string;
  recordId?: string;
  metadata?: Record<string, unknown>;
}

export interface DexcomReadingPayload {
  value: number;
  unit: string;
  timestamp: string;
  trend?: string;
  trendRate?: number;
  recordId?: string;
}
