import type { SourceType } from "@/lib/db/schema";

/** OAuth credentials for a live source, stored in source_connection.metadata. */
export interface DexcomCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  scope: string;
  apiBase: string;
}

/** Persisted garmin-connect-client session bundle (its PersistedSession).
 *  Stored in source_connection.metadata.garmin. The lib auto-refreshes the
 *  OAuth2 token using refresh_token + diClientId — no OAuth1 token. */
export interface GarminCreds {
  cookies?: string;
  oauth2Token: {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
    expires_at?: number;
    refresh_token_expires_at?: number;
  };
  diClientId: string;
}

/** Any source's persisted credential bundle. */
export type SourceCreds = DexcomCreds | GarminCreds;

/** The connection a connector is syncing, as the connector needs to see it. */
export interface SyncConnection {
  id: string;
  userId: string;
  sourceType: SourceType;
  metadata: Record<string, unknown>;
  lastSyncAt: Date | null;
}

/** Context passed to a connector's sync(): the connection, the clock, and a
 *  callback to persist rotated credentials back to the connection. */
export interface ConnectorSyncContext {
  connection: SyncConnection;
  now: Date;
  saveCredentials(creds: DexcomCreds): Promise<void>;
}

/** A source connector emits raw payloads to be run through the ingest pipeline.
 *  v0 connectors fall back to mock; live connectors read tokens from ctx. */
export interface Connector {
  readonly sourceType: SourceType;
  sync(ctx: ConnectorSyncContext): Promise<unknown[]>;
}
