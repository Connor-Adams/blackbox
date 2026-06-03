import type { Connector, ConnectorSyncContext, DexcomCreds } from "./types";
import type { DexcomReadingPayload } from "@/lib/domain/types";
import { glucoseNormalDay, glucoseVolatileDay } from "@/lib/mock/data";
import { getDexcomEnv } from "./dexcom-env";
import { refresh } from "./dexcom-oauth";
import { dexcomDate, egvToPayload, fetchEgvs } from "./dexcom-api";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 60 * 60 * 1000;

function readCreds(metadata: Record<string, unknown>): DexcomCreds | null {
  const c = metadata.dexcom as DexcomCreds | undefined;
  return c?.refreshToken ? c : null;
}

/** Dexcom connector. Mock (seeded) when the connection has no credentials;
 *  live EGV fetch when it does. Rotated refresh tokens are persisted via ctx. */
export const dexcomConnector: Connector = {
  sourceType: "dexcom",
  async sync(ctx: ConnectorSyncContext): Promise<unknown[]> {
    const stored = readCreds(ctx.connection.metadata);
    if (!stored) {
      return [...glucoseNormalDay, ...glucoseVolatileDay];
    }

    let creds = stored;
    if (new Date(creds.expiresAt).getTime() <= ctx.now.getTime()) {
      const env = getDexcomEnv();
      creds = await refresh({ ...env, apiBase: creds.apiBase }, creds.refreshToken, ctx.now);
      await ctx.saveCredentials(creds);
    }

    // Re-fetch from an hour before the last sync so Dexcom's publish lag can't
    // drop late-arriving readings; recordId dedup makes the overlap free.
    const start = ctx.connection.lastSyncAt
      ? new Date(ctx.connection.lastSyncAt.getTime() - LOOKBACK_MS)
      : new Date(ctx.now.getTime() - DAY_MS);
    const records = await fetchEgvs(creds.accessToken, creds.apiBase, dexcomDate(start), dexcomDate(ctx.now));
    return records
      .map(egvToPayload)
      .filter((p): p is DexcomReadingPayload => p !== null);
  },
};
