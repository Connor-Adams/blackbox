/**
 * THROWAWAY live-first spike for the Garmin connector (delete after).
 *
 * Proves, against a real Garmin account:
 *   1. login() authenticates (no-MFA path) via garmin-connect-client (JA3 SSO).
 *   2. getSession() yields a persistable bundle, and fromSession() restores it.
 *   3. The documented public getters work (activities, sleep).
 *   4. Full-intraday "everything" is reachable: arbitrary connectapi.garmin.com
 *      endpoints replayed through the internal axios HttpClient + bearer token
 *      (the JA3 curl transport is only needed for the SSO login handshake).
 *
 * Creds come from a gitignored .env.local (or .env): GARMIN_EMAIL / GARMIN_PASSWORD.
 * Nothing secret is printed; the session is written to .garmin-session.local.json (gitignored).
 *
 * Run: pnpm garmin:spike
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig(); // .env fallback; does not override already-set vars

import { writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import { login, fromSession } from "garmin-connect-client";
// Deep imports — the package ships no "exports" map, so internal modules resolve.
import { HttpClient } from "garmin-connect-client/dist/http-client.js";
import { GarminUrls } from "garmin-connect-client/dist/urls.js";

const CONNECT_API = "https://connectapi.garmin.com";
const yesterday = DateTime.now().minus({ days: 1 });
const dateStr = yesterday.toISODate()!; // YYYY-MM-DD

type ProbeRow = { label: string; ok: boolean; status?: number | string; note: string };

function shape(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]` + (v.length ? ` keys=${Object.keys(v[0] ?? {}).slice(0, 10).join(",")}` : "");
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object);
    return `object{${keys.slice(0, 14).join(",")}${keys.length > 14 ? ",…" : ""}}`;
  }
  return `${typeof v}: ${String(v).slice(0, 40)}`;
}

function errInfo(e: unknown): { status?: number | string; note: string } {
  const any = e as { status?: number; response?: { status?: number }; statusCode?: number; name?: string; message?: string };
  const status = any?.status ?? any?.response?.status ?? any?.statusCode;
  return { status, note: `${any?.name ?? "Error"}: ${(any?.message ?? String(e)).slice(0, 160)}` };
}

async function main() {
  const username = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!username || !password) {
    console.error(
      "\nMissing creds. Add to a gitignored .env.local (or .env):\n" +
        "  GARMIN_EMAIL=you@example.com\n" +
        "  GARMIN_PASSWORD=your-garmin-password\n",
    );
    process.exit(1);
  }

  const rows: ProbeRow[] = [];

  // --- 1. Login ------------------------------------------------------------
  console.log(`\n[1] login() as ${username.replace(/(.{2}).*(@.*)/, "$1***$2")} …`);
  let session;
  try {
    const result = await login({ username, password });
    if (result.mfaRequired) {
      console.error("[1] FAIL: server demanded MFA, but this account was expected to have none. Aborting.");
      process.exit(2);
    }
    session = result.client.getSession();
    console.log("[1] OK — authenticated.");
    console.log(
      "    session keys:",
      Object.keys(session as object).join(","),
      "| oauth2Token keys:",
      Object.keys((session as { oauth2Token?: object }).oauth2Token ?? {}).join(","),
      "| diClientId:",
      (session as { diClientId?: string }).diClientId ? "present" : "absent",
    );
  } catch (e) {
    const { status, note } = errInfo(e);
    console.error(`[1] FAIL (status=${status}): ${note}`);
    process.exit(2);
  }

  // --- 2. Persist + restore ------------------------------------------------
  console.log("\n[2] getSession() → file → fromSession() round-trip …");
  let restored;
  try {
    writeFileSync(".garmin-session.local.json", JSON.stringify(session, null, 2));
    restored = fromSession(session);
    console.log("[2] OK — wrote .garmin-session.local.json and restored a client from it.");
  } catch (e) {
    console.error("[2] FAIL:", errInfo(e).note);
    process.exit(3);
  }

  // --- 3. Public getters (restored client proves the session is usable) ----
  console.log("\n[3] public getters …");
  try {
    const acts = await restored.getActivities(0, 5);
    rows.push({ label: "getActivities(0,5)", ok: true, status: 200, note: shape(acts) });
  } catch (e) {
    const { status, note } = errInfo(e);
    rows.push({ label: "getActivities(0,5)", ok: false, status, note });
  }
  try {
    const sleep = await restored.sleep.getDailySleepData(yesterday);
    rows.push({ label: `sleep.getDailySleepData(${dateStr})`, ok: true, status: 200, note: shape(sleep) });
  } catch (e) {
    const { status, note } = errInfo(e);
    rows.push({ label: "sleep.getDailySleepData()", ok: false, status, note });
  }

  // --- 4. Arbitrary connectapi endpoints via internal HttpClient replay ----
  console.log("\n[4] intraday/daily endpoints via HttpClient replay …");
  const http = new HttpClient(new GarminUrls(), session);

  // Need displayName for the per-user summary/wellness endpoints.
  let displayName: string | undefined;
  try {
    const profile = await http.get<{ displayName?: string }>(`${CONNECT_API}/userprofile-service/socialProfile`);
    displayName = profile?.displayName;
    rows.push({ label: "userprofile socialProfile", ok: true, status: 200, note: `displayName=${displayName ?? "?"}` });
  } catch (e) {
    const { status, note } = errInfo(e);
    rows.push({ label: "userprofile socialProfile", ok: false, status, note });
  }

  const dn = displayName ?? "";
  const probes: Array<[string, string]> = [
    ["daily summary", `${CONNECT_API}/usersummary-service/usersummary/daily/${dn}?calendarDate=${dateStr}`],
    ["intraday heart rate", `${CONNECT_API}/wellness-service/wellness/dailyHeartRate/${dn}?date=${dateStr}`],
    ["intraday stress + body battery", `${CONNECT_API}/wellness-service/wellness/dailyStress/${dateStr}`],
    ["body battery report", `${CONNECT_API}/wellness-service/wellness/bodyBattery/reports/daily?startDate=${dateStr}&endDate=${dateStr}`],
    ["SpO2 daily", `${CONNECT_API}/wellness-service/wellness/daily/spo2/${dateStr}`],
    ["respiration daily", `${CONNECT_API}/wellness-service/wellness/daily/respiration/${dateStr}`],
    ["steps intraday chart", `${CONNECT_API}/wellness-service/wellness/dailySummaryChart/${dn}?date=${dateStr}`],
    ["VO2max / maxmetrics", `${CONNECT_API}/metrics-service/metrics/maxmet/daily/${dateStr}/${dateStr}`],
    ["HRV daily", `${CONNECT_API}/hrv-service/hrv/${dateStr}`],
    ["training readiness", `${CONNECT_API}/metrics-service/metrics/trainingreadiness/${dateStr}`],
    ["training status", `${CONNECT_API}/metrics-service/metrics/trainingstatus/aggregated/${dateStr}`],
    ["activities search (raw)", `${CONNECT_API}/activitylist-service/activities/search/activities?start=0&limit=3`],
  ];

  for (const [label, url] of probes) {
    try {
      const data = await http.get(url);
      rows.push({ label, ok: true, status: 200, note: shape(data) });
    } catch (e) {
      const { status, note } = errInfo(e);
      rows.push({ label, ok: false, status, note });
    }
  }

  // --- Report --------------------------------------------------------------
  console.log("\n========== SPIKE RESULTS ==========");
  for (const r of rows) {
    console.log(`${r.ok ? "✅" : "❌"} [${String(r.status ?? "-").padStart(3)}] ${r.label}\n      ${r.note}`);
  }
  const okCount = rows.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${rows.length} probes returned data.`);
  console.log("Verdict: auth", session ? "WORKS" : "FAILED", "| full-intraday reachable via HttpClient replay:", rows.some((r) => r.ok && /heart rate|stress|spo2|respiration|body battery/i.test(r.label)) ? "YES" : "NO/PARTIAL");
  console.log("===================================\n");
}

main().catch((e) => {
  console.error("Spike crashed:", e);
  process.exit(1);
});
