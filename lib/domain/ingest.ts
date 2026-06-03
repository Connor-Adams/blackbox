import type { SourceType } from "@/lib/db/schema";
import type {
  DexcomReadingPayload,
  ManualAnnotationPayload,
  NormalizedObservation,
  NormalizedTimelineEvent,
  RawEventInput,
} from "@/lib/domain/types";
import { payloadHash } from "@/lib/domain/dedup";
import { normalize } from "@/lib/domain/normalize";

/** A source connection as the ingest pipeline needs it. */
export interface IngestConnection {
  id: string;
  userId: string;
  sourceType: SourceType;
}

/** A row ready to insert into raw_event (id + receivedAt are assigned by the DB). */
export interface RawEventRow {
  sourceConnectionId: string;
  importBatchId: string | null;
  sourceType: SourceType;
  sourceRecordId: string | null;
  occurredAt: Date;
  payload: unknown;
  payloadHash: string;
}

/** Per-source extraction of the dedupe id + the event's occurrence time. */
export function extractRawMeta(
  sourceType: SourceType,
  payload: unknown,
): { sourceRecordId: string | null; occurredAt: Date } {
  switch (sourceType) {
    case "manual": {
      const p = payload as ManualAnnotationPayload;
      return { sourceRecordId: p.recordId ?? null, occurredAt: new Date(p.timestamp) };
    }
    case "dexcom": {
      const p = payload as DexcomReadingPayload;
      return { sourceRecordId: p.recordId ?? null, occurredAt: new Date(p.timestamp) };
    }
    default:
      throw new Error(`ingest does not support source type: ${sourceType}`);
  }
}

/** Build a raw_event row from a connection + a source payload (pure). */
export function buildRawEventRow(conn: IngestConnection, payload: unknown): RawEventRow {
  const { sourceRecordId, occurredAt } = extractRawMeta(conn.sourceType, payload);
  return {
    sourceConnectionId: conn.id,
    importBatchId: null,
    sourceType: conn.sourceType,
    sourceRecordId,
    occurredAt,
    payload,
    payloadHash: payloadHash(payload),
  };
}

export interface IngestStore {
  upsertRawEvent(row: RawEventRow): Promise<{ id: string; created: boolean }>;
  upsertObservation(obs: NormalizedObservation): Promise<void>;
  upsertTimelineEvent(ev: NormalizedTimelineEvent): Promise<void>;
}

export interface IngestResult {
  found: number;
  created: number;
  observations: number;
  timelineEvents: number;
}

/** Run payloads through the pipeline: build + upsert raw events, then normalize
 *  each and upsert its observations/timeline events. Idempotent — repeated runs
 *  dedupe at upsertRawEvent and overwrite normalized rows in place. */
export async function ingestRawEvents(
  store: IngestStore,
  conn: IngestConnection,
  payloads: unknown[],
): Promise<IngestResult> {
  let created = 0;
  let observations = 0;
  let timelineEvents = 0;

  for (const payload of payloads) {
    const row = buildRawEventRow(conn, payload);
    const { id, created: isNew } = await store.upsertRawEvent(row);
    if (isNew) created += 1;

    const rawInput: RawEventInput = {
      id,
      userId: conn.userId,
      sourceConnectionId: conn.id,
      sourceType: conn.sourceType,
      sourceRecordId: row.sourceRecordId,
      occurredAt: row.occurredAt,
      payload,
    };
    const normalized = normalize(rawInput);
    for (const obs of normalized.observations) {
      await store.upsertObservation(obs);
      observations += 1;
    }
    for (const ev of normalized.timelineEvents) {
      await store.upsertTimelineEvent(ev);
      timelineEvents += 1;
    }
  }

  return { found: payloads.length, created, observations, timelineEvents };
}
