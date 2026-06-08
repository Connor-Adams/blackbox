import type { Connector, ConnectorSyncContext, GarminCreds } from "./types";
import { garminMockDay } from "@/lib/mock/garmin";
import { httpFromCreds } from "./garmin-auth";
import { fetchActivities, fetchDay, getDisplayName, syncDates } from "./garmin-api";

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

    const http = httpFromCreds(creds);
    const displayName = await getDisplayName(http);
    const dates = syncDates(ctx.connection.lastSyncAt, ctx.now);

    const payloads: unknown[] = [];
    for (let i = 0; i < dates.length; i++) {
      payloads.push(...(await fetchDay(http, displayName, dates[i])));
      if (i < dates.length - 1) await sleep(RATE_LIMIT_MS);
    }
    payloads.push(...(await fetchActivities(http, dates[0], dates[dates.length - 1])));
    return payloads;
  },
};
