import type { Connector, ConnectorSyncContext, GarminCreds } from "./types";
import { garminMockDay } from "@/lib/mock/garmin";
import { httpFromCreds } from "./garmin-auth";
import { fetchActivities, fetchDay, fetchWindowExtras, getDisplayName, syncDates } from "./garmin-api";

/** Polite delay between per-day fetches on multi-day (backfill) syncs. */
const RATE_LIMIT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readCreds(metadata: Record<string, unknown>): GarminCreds | null {
  const c = metadata.garmin as GarminCreds | undefined;
  return c?.oauth2Token?.access_token ? c : null;
}

/** Garmin connector. Mock (seeded) when the connection has no credentials;
 *  live intraday + activity fetch when it does. */
export const garminConnector: Connector = {
  sourceType: "garmin",
  async sync(ctx: ConnectorSyncContext): Promise<unknown[]> {
    const creds = readCreds(ctx.connection.metadata);
    if (!creds) {
      return garminMockDay;
    }

    const dates = syncDates(ctx.connection.lastSyncAt, ctx.now);
    if (dates.length === 0) return []; // lastSyncAt ahead of now (clock skew) — nothing to do

    const http = httpFromCreds(creds);
    // Persist rotated OAuth2 tokens so the next sync starts from a fresh bundle.
    http.onSessionUpdate((session) => ctx.saveCredentials(session));

    const displayName = await getDisplayName(http);

    const payloads: unknown[] = [];
    for (let i = 0; i < dates.length; i++) {
      payloads.push(...(await fetchDay(http, displayName, dates[i])));
      if (i < dates.length - 1) await sleep(RATE_LIMIT_MS);
    }
    payloads.push(...(await fetchActivities(http, dates[0], dates[dates.length - 1])));
    payloads.push(...(await fetchWindowExtras(http, displayName, dates[0], dates[dates.length - 1])));
    return payloads;
  },
};
