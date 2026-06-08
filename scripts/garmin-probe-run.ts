/**
 * Run the Garmin endpoint probe against an already-saved session bundle
 * (.garmin-session.local.json, written by `pnpm garmin:login`). No credentials
 * needed — uses the persisted token bundle only.
 *
 *   pnpm garmin:probe
 */
import { readFileSync } from "node:fs";
import { probeAndReport } from "./garmin-probe";

const FILE = ".garmin-session.local.json";

let session: unknown;
try {
  session = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
  console.error(`Could not read ${FILE}. Run \`pnpm garmin:login\` first.`);
  process.exit(1);
}

probeAndReport(session).catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
