import type { IngestResult } from "@/lib/domain/ingest";
import type { Connector, ConnectorSyncContext, DexcomCreds, SyncConnection } from "./types";

/** Side-effecting operations executeSync needs. DB-backed impl lives in lib/db. */
export interface SyncStore {
  saveCredentials(connectionId: string, creds: DexcomCreds): Promise<void>;
  ingest(
    conn: { id: string; userId: string; sourceType: SyncConnection["sourceType"] },
    payloads: unknown[],
  ): Promise<IngestResult>;
  markSynced(connectionId: string): Promise<void>;
  markError(connectionId: string, message: string): Promise<void>;
}

export type SyncResult =
  | { ok: false; error: string }
  | { ok: true; found: number; created: number; observations: number; timelineEvents: number };

/** Run one connection's connector and ingest its payloads. Pure orchestration:
 *  all IO goes through `store`. On any throw, the connection is marked error. */
export async function executeSync(
  store: SyncStore,
  connector: Connector,
  conn: SyncConnection,
  now: Date,
): Promise<SyncResult> {
  try {
    const ctx: ConnectorSyncContext = {
      connection: conn,
      now,
      saveCredentials: (creds) => store.saveCredentials(conn.id, creds),
    };
    const payloads = await connector.sync(ctx);
    const result = await store.ingest(
      { id: conn.id, userId: conn.userId, sourceType: conn.sourceType },
      payloads,
    );
    await store.markSynced(conn.id);
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.markError(conn.id, message);
    return { ok: false, error: message };
  }
}
