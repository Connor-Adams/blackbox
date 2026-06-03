import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sourceConnection } from "@/lib/db/schema";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import { getConnector } from "@/lib/connectors";

type Db = ReturnType<typeof getDb>;

export async function listSourceConnections(userId: string, db: Db = getDb()) {
  return db.select().from(sourceConnection).where(eq(sourceConnection.userId, userId));
}

export type SyncResult =
  | { ok: false; error: string }
  | { ok: true; found: number; created: number; observations: number; timelineEvents: number };

/** Load a connection, run its connector, ingest the payloads, stamp lastSyncAt.
 *  Idempotent (ingest dedupes). */
export async function runConnectorSync(connectionId: string, db: Db = getDb()): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(sourceConnection)
    .where(eq(sourceConnection.id, connectionId))
    .limit(1);
  if (!conn) return { ok: false, error: "connection not found" };

  const connector = getConnector(conn.sourceType);
  if (!connector) return { ok: false, error: `no connector for source "${conn.sourceType}"` };

  const payloads = await connector.sync();
  const result = await ingestRawEvents(
    new DbIngestStore(db),
    { id: conn.id, userId: conn.userId, sourceType: conn.sourceType },
    payloads,
  );
  await db.update(sourceConnection).set({ lastSyncAt: new Date(), status: "active" }).where(eq(sourceConnection.id, conn.id));
  return { ok: true, ...result };
}
