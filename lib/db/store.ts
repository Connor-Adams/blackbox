import { and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observation, rawEvent, sourceConnection, timelineEvent } from "@/lib/db/schema";
import type { ObservationMetric, SourceType, TimelineEventType } from "@/lib/db/schema";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import type { IngestStore, RawEventRow } from "@/lib/domain/ingest";
import type {
  NormalizedObservation,
  NormalizedTimelineEvent,
} from "@/lib/domain/types";

type Db = ReturnType<typeof getDb>;

/** Drizzle-backed ingest store. Uses select-then-insert for idempotency
 *  (mirrors raw_event's partial unique indexes without ON CONFLICT gymnastics). */
export class DbIngestStore implements IngestStore {
  constructor(private readonly db: Db = getDb()) {}

  async upsertRawEvent(row: RawEventRow): Promise<{ id: string; created: boolean }> {
    const where =
      row.sourceRecordId !== null
        ? and(
            eq(rawEvent.sourceConnectionId, row.sourceConnectionId),
            eq(rawEvent.sourceRecordId, row.sourceRecordId),
          )
        : and(
            eq(rawEvent.sourceConnectionId, row.sourceConnectionId),
            eq(rawEvent.payloadHash, row.payloadHash),
          );

    const [existing] = await this.db
      .select({ id: rawEvent.id })
      .from(rawEvent)
      .where(where)
      .limit(1);
    if (existing) return { id: existing.id, created: false };

    const [inserted] = await this.db
      .insert(rawEvent)
      .values({
        sourceConnectionId: row.sourceConnectionId,
        importBatchId: row.importBatchId,
        sourceType: row.sourceType,
        sourceRecordId: row.sourceRecordId,
        occurredAt: row.occurredAt,
        payload: row.payload,
        payloadHash: row.payloadHash,
      })
      .returning({ id: rawEvent.id });
    return { id: inserted.id, created: true };
  }

  async upsertObservation(obs: NormalizedObservation): Promise<void> {
    const [existing] = await this.db
      .select({ id: observation.id })
      .from(observation)
      .where(and(eq(observation.rawEventId, obs.rawEventId), eq(observation.metric, obs.metric as ObservationMetric)))
      .limit(1);
    const values = {
      userId: obs.userId,
      rawEventId: obs.rawEventId,
      sourceType: obs.sourceType,
      metric: obs.metric as ObservationMetric,
      value: obs.value,
      unit: obs.unit,
      observedAt: obs.observedAt,
      metadata: obs.metadata as Record<string, unknown>,
    };
    if (existing) {
      await this.db.update(observation).set(values).where(eq(observation.id, existing.id));
    } else {
      await this.db.insert(observation).values(values);
    }
  }

  async upsertTimelineEvent(ev: NormalizedTimelineEvent): Promise<void> {
    if (ev.rawEventId === null) {
      await this.db.insert(timelineEvent).values(toTimelineValues(ev));
      return;
    }
    const [existing] = await this.db
      .select({ id: timelineEvent.id })
      .from(timelineEvent)
      .where(eq(timelineEvent.rawEventId, ev.rawEventId))
      .limit(1);
    if (existing) {
      await this.db.update(timelineEvent).set(toTimelineValues(ev)).where(eq(timelineEvent.id, existing.id));
    } else {
      await this.db.insert(timelineEvent).values(toTimelineValues(ev));
    }
  }
}

function toTimelineValues(ev: NormalizedTimelineEvent) {
  return {
    userId: ev.userId,
    rawEventId: ev.rawEventId,
    sourceType: ev.sourceType,
    eventType: ev.eventType as TimelineEventType,
    title: ev.title,
    description: ev.description,
    startedAt: ev.startedAt,
    endedAt: ev.endedAt,
    metadata: ev.metadata as Record<string, unknown>,
  };
}

/** Timeline events + glucose observations for one UTC calendar day. */
export async function getTimeline(userId: string, date: string, db: Db = getDb()) {
  const { start, end } = dayRange(date);
  const events = await db
    .select()
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.userId, userId),
        gte(timelineEvent.startedAt, start),
        lt(timelineEvent.startedAt, end),
      ),
    );
  const observations = await db
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.userId, userId),
        gte(observation.observedAt, start),
        lt(observation.observedAt, end),
      ),
    );
  return { events, observations };
}

/** Insert a source connection with a fixed id if it does not already exist
 *  (idempotent). Returns the IngestConnection shape. */
export async function ensureSourceConnection(
  input: { id: string; sourceType: SourceType; displayName: string },
  db: Db = getDb(),
): Promise<{ id: string; userId: string; sourceType: SourceType }> {
  const [existing] = await db
    .select({ id: sourceConnection.id })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, input.id))
    .limit(1);
  if (!existing) {
    await db.insert(sourceConnection).values({
      id: input.id,
      userId: SEED_USER_ID,
      sourceType: input.sourceType,
      displayName: input.displayName,
      status: "active",
    });
  }
  return { id: input.id, userId: SEED_USER_ID, sourceType: input.sourceType };
}
