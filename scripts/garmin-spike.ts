/**
 * THROWAWAY env-creds Garmin spike (delete after the connector lands).
 *
 * Prefer `pnpm garmin:login` for interactive credential entry. This variant
 * reads GARMIN_EMAIL / GARMIN_PASSWORD from a gitignored .env.local (or .env)
 * for headless/CI use, logs in, persists the session bundle, and probes the
 * Garmin endpoints. Nothing secret is printed; the session bundle is written to
 * .garmin-session.local.json (gitignored).
 *
 * Run: pnpm garmin:spike
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig(); // .env fallback; does not override already-set vars

import { writeFileSync } from "node:fs";
import { login } from "garmin-connect-client";
import { probeAndReport, errInfo } from "./garmin-probe";

const SESSION_FILE = ".garmin-session.local.json";

async function main() {
  const username = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!username || !password) {
    console.error(
      "\nMissing creds. Either run `pnpm garmin:login` (interactive), or set in a gitignored .env.local:\n" +
        "  GARMIN_EMAIL=you@example.com\n" +
        "  GARMIN_PASSWORD=your-garmin-password\n",
    );
    process.exit(1);
  }

  console.log(`Logging in as ${username.replace(/(.{2}).*(@.*)/, "$1***$2")} …`);
  let client;
  try {
    const result = await login({ username, password });
    if (result.mfaRequired) {
      console.error("Account requires 2FA — use `pnpm garmin:login` for interactive code entry.");
      process.exit(2);
    }
    client = result.client;
  } catch (e) {
    const { status, note } = errInfo(e);
    console.error(`Login failed${status ? ` (status ${status})` : ""}: ${note}`);
    process.exit(2);
  }

  const session = client.getSession();
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  console.log(`Authenticated. Session bundle written to ${SESSION_FILE}.`);

  await probeAndReport(session);
}

main().catch((e) => {
  console.error("Spike crashed:", e);
  process.exit(1);
});
