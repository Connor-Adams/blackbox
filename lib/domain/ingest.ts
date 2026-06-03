import type { SourceType } from "@/lib/db/schema";
import type {
  DexcomReadingPayload,
  ManualAnnotationPayload,
} from "@/lib/domain/types";
import { payloadHash } from "@/lib/domain/dedup";

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
      return { sourceRecordId: null, occurredAt: new Date(p.timestamp) };
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
