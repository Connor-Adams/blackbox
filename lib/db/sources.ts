import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sourceConnection, type SourceType } from "@/lib/db/schema";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import { getConnector } from "@/lib/connectors";
import { executeSync, type SyncResult, type SyncStore } from "@/lib/connectors/sync";
import type { DexcomCreds, GarminCreds, SourceCreds, SyncConnection } from "@/lib/connectors/types";
import { SEED_USER_ID, LIVE_DEXCOM_CONNECTION_ID, LIVE_GARMIN_CONNECTION_ID } from "@/lib/constants";

type Db = ReturnType<typeof getDb>;

export async function listSourceConnections(userId: string, db: Db = getDb()) {
  return db.select().from(sourceConnection).where(eq(sourceConnection.userId, userId));
}

/** DB-backed SyncStore: persists creds/status into source_connection and runs
 *  the ingest pipeline. */
class DbSyncStore implements SyncStore {
  constructor(private readonly db: Db) {}

  async saveCredentials(connectionId: string, sourceType: SourceType, creds: SourceCreds): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}), [sourceType]: creds };
    await this.db.update(sourceConnection).set({ metadata }).where(eq(sourceConnection.id, connectionId));
  }

  async ingest(conn: { id: string; userId: string; sourceType: SyncConnection["sourceType"] }, payloads: unknown[]) {
    return ingestRawEvents(new DbIngestStore(this.db), conn, payloads);
  }

  async markSynced(connectionId: string): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}) };
    delete (metadata as Record<string, unknown>).lastError;
    await this.db
      .update(sourceConnection)
      .set({ lastSyncAt: new Date(), status: "active", metadata })
      .where(eq(sourceConnection.id, connectionId));
  }

  async markError(connectionId: string, message: string): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}), lastError: message };
    await this.db.update(sourceConnection).set({ status: "error", metadata }).where(eq(sourceConnection.id, connectionId));
  }
}

/** Load a connection, run its connector through executeSync (idempotent ingest,
 *  credential rotation, error capture). */
export async function runConnectorSync(connectionId: string, db: Db = getDb()): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(sourceConnection)
    .where(eq(sourceConnection.id, connectionId))
    .limit(1);
  if (!conn) return { ok: false, error: "connection not found" };

  const connector = getConnector(conn.sourceType);
  if (!connector) return { ok: false, error: `no connector for source "${conn.sourceType}"` };

  const syncConn: SyncConnection = {
    id: conn.id,
    userId: conn.userId,
    sourceType: conn.sourceType,
    metadata: conn.metadata ?? {},
    lastSyncAt: conn.lastSyncAt ?? null,
  };
  return executeSync(new DbSyncStore(db), connector, syncConn, new Date());
}

/** Create or update the dedicated live Dexcom connection with fresh creds. */
export async function upsertLiveDexcomConnection(creds: DexcomCreds, db: Db = getDb()): Promise<string> {
  const [existing] = await db
    .select({ id: sourceConnection.id, metadata: sourceConnection.metadata })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, LIVE_DEXCOM_CONNECTION_ID))
    .limit(1);

  if (existing) {
    const metadata = { ...(existing.metadata ?? {}), dexcom: creds };
    await db
      .update(sourceConnection)
      .set({ status: "active", metadata })
      .where(eq(sourceConnection.id, LIVE_DEXCOM_CONNECTION_ID));
  } else {
    await db.insert(sourceConnection).values({
      id: LIVE_DEXCOM_CONNECTION_ID,
      userId: SEED_USER_ID,
      sourceType: "dexcom",
      displayName: "Dexcom",
      status: "active",
      metadata: { dexcom: creds },
    });
  }
  return LIVE_DEXCOM_CONNECTION_ID;
}

/** Create or update the dedicated live Garmin connection with a fresh session bundle. */
export async function upsertLiveGarminConnection(creds: GarminCreds, db: Db = getDb()): Promise<string> {
  const [existing] = await db
    .select({ id: sourceConnection.id, metadata: sourceConnection.metadata })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, LIVE_GARMIN_CONNECTION_ID))
    .limit(1);

  if (existing) {
    const metadata = { ...(existing.metadata ?? {}), garmin: creds };
    await db
      .update(sourceConnection)
      .set({ status: "active", metadata })
      .where(eq(sourceConnection.id, LIVE_GARMIN_CONNECTION_ID));
  } else {
    await db.insert(sourceConnection).values({
      id: LIVE_GARMIN_CONNECTION_ID,
      userId: SEED_USER_ID,
      sourceType: "garmin",
      displayName: "Garmin",
      status: "active",
      metadata: { garmin: creds },
    });
  }
  return LIVE_GARMIN_CONNECTION_ID;
}
