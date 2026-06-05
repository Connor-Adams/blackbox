import type { Connector, ConnectorSyncContext, GarminCreds } from "./types";
import { garminMockDay } from "@/lib/mock/garmin";

function readCreds(metadata: Record<string, unknown>): GarminCreds | null {
  const c = metadata.garmin as GarminCreds | undefined;
  return c?.oauth2Token?.access_token ? c : null;
}

/** Garmin connector. Mock (seeded) when the connection has no credentials;
 *  live fetch (a later task) when it does. */
export const garminConnector: Connector = {
  sourceType: "garmin",
  async sync(ctx: ConnectorSyncContext): Promise<unknown[]> {
    const creds = readCreds(ctx.connection.metadata);
    if (!creds) {
      return garminMockDay;
    }
    // Live path implemented in a later task.
    throw new Error("garmin live sync not yet implemented");
  },
};
