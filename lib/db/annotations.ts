import { getDb } from "@/lib/db/client";
import { annotation } from "@/lib/db/schema";
import type { AnnotationType } from "@/lib/db/schema";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import type { AnnotationInput } from "@/lib/api/annotation-input";
import type { ManualAnnotationPayload } from "@/lib/domain/types";
import { SEED_MANUAL_CONNECTION_ID } from "@/lib/constants";

/** Persist a manual annotation: write the annotation row, then run it through
 *  the ingest pipeline (manual source) so a timeline event is created. The
 *  annotation id is the raw event's source record id (idempotent + links them). */
export async function createAnnotation(input: AnnotationInput): Promise<{ id: string }> {
  const db = getDb();
  const conn = await ensureSourceConnection({
    id: SEED_MANUAL_CONNECTION_ID,
    sourceType: "manual",
    displayName: "Manual log",
  });

  const [row] = await db
    .insert(annotation)
    .values({
      userId: conn.userId,
      type: input.type as AnnotationType,
      title: input.title,
      startedAt: new Date(input.timestamp),
      endedAt: input.endTimestamp ? new Date(input.endTimestamp) : null,
      notes: input.notes ?? null,
    })
    .returning({ id: annotation.id });

  const payload: ManualAnnotationPayload = {
    type: input.type as AnnotationType,
    title: input.title,
    timestamp: input.timestamp,
    endTimestamp: input.endTimestamp,
    notes: input.notes,
    recordId: row.id,
  };
  await ingestRawEvents(new DbIngestStore(db), conn, [payload]);

  return { id: row.id };
}
