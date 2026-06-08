/**
 * Make Garmin live: push the saved session bundle into the database as the live
 * Garmin connection, then run a sync (pulls the last 7 days on first run).
 *
 *   1. pnpm garmin:login     # interactive — writes .garmin-session.local.json
 *   2. pnpm garmin:connect   # this — upserts the live connection + syncs
 *
 * Requires DATABASE_URL (a running Postgres). After it completes, the data shows
 * up on /timeline like any other source.
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig(); // .env fallback

import { readFileSync } from "node:fs";
import { runConnectorSync, upsertLiveGarminConnection } from "@/lib/db/sources";
import type { GarminCreds } from "@/lib/connectors/types";

const FILE = ".garmin-session.local.json";

async function main() {
  let creds: GarminCreds;
  try {
    creds = JSON.parse(readFileSync(FILE, "utf8")) as GarminCreds;
  } catch {
    console.error(`Could not read ${FILE}. Run \`pnpm garmin:login\` first.`);
    process.exit(1);
  }
  if (!creds?.oauth2Token?.access_token) {
    console.error(`${FILE} has no token bundle. Run \`pnpm garmin:login\` again.`);
    process.exit(1);
  }

  console.log("Saving live Garmin connection to the database …");
  const id = await upsertLiveGarminConnection(creds);
  console.log(`Connection ${id} is active. Syncing (first run pulls ~7 days; this can take a minute) …`);
  const result = await runConnectorSync(id);
  console.log("\nSync result:", result);
  if (result.ok) {
    console.log(`\n✅ Done — ${result.observations} observations + ${result.timelineEvents} events ingested. Open /timeline to see them.`);
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("connect failed:", e);
  process.exit(1);
});
