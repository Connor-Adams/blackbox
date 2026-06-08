/**
 * Shared Garmin endpoint probe (dev/spike only — not shipped).
 *
 * Given a persisted session bundle, restores a client, exercises the public
 * getters, and replays arbitrary connectapi.garmin.com endpoints through the
 * internal axios HttpClient + bearer (the JA3 curl transport is only needed for
 * the SSO login handshake). Prints a ✅/❌ table + a reachability verdict.
 *
 * Used by both `garmin-login.ts` (interactive) and `garmin-spike.ts` (env creds).
 */
import { fromSession } from "garmin-connect-client";
// Deep imports — the package ships no "exports" map, so internal modules resolve.
import { HttpClient } from "garmin-connect-client/dist/http-client.js";
import { GarminUrls } from "garmin-connect-client/dist/urls.js";
import { DateTime } from "luxon";

const CONNECT_API = "https://connectapi.garmin.com";

type ProbeRow = { label: string; ok: boolean; status?: number | string; note: string };

function shape(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]` + (v.length ? ` keys=${Object.keys(v[0] ?? {}).slice(0, 10).join(",")}` : "");
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object);
    return `object{${keys.slice(0, 14).join(",")}${keys.length > 14 ? ",…" : ""}}`;
  }
  return `${typeof v}: ${String(v).slice(0, 40)}`;
}

export function errInfo(e: unknown): { status?: number | string; note: string } {
  const any = e as { status?: number; response?: { status?: number }; statusCode?: number; name?: string; message?: string };
  const status = any?.status ?? any?.response?.status ?? any?.statusCode;
  return { status, note: `${any?.name ?? "Error"}: ${(any?.message ?? String(e)).slice(0, 160)}` };
}

/** Restore the session, probe public getters + intraday endpoints, print a report. */
export async function probeAndReport(session: unknown): Promise<void> {
  const yesterday = DateTime.now().minus({ days: 1 });
  const dateStr = yesterday.toISODate()!; // YYYY-MM-DD
  const rows: ProbeRow[] = [];

  // --- Restore (proves the persisted bundle is usable) ---------------------
  console.log("\n[restore] fromSession() …");
  let restored;
  try {
    restored = fromSession(session as never);
    console.log("[restore] OK — client restored from the session bundle.");
  } catch (e) {
    console.error("[restore] FAIL:", errInfo(e).note);
    return;
  }

  // --- Public getters ------------------------------------------------------
  console.log("\n[getters] public client methods …");
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

  // --- Arbitrary connectapi endpoints via internal HttpClient replay -------
  console.log("\n[replay] intraday/daily endpoints via HttpClient …");
  const http = new HttpClient(new GarminUrls(), session as never);

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
  console.log("\n========== PROBE RESULTS ==========");
  for (const r of rows) {
    console.log(`${r.ok ? "✅" : "❌"} [${String(r.status ?? "-").padStart(3)}] ${r.label}\n      ${r.note}`);
  }
  const okCount = rows.filter((r) => r.ok).length;
  const intradayReachable = rows.some((r) => r.ok && /heart rate|stress|spo2|respiration|body battery/i.test(r.label));
  console.log(`\n${okCount}/${rows.length} probes returned data.`);
  console.log(`Verdict: full-intraday reachable via HttpClient replay: ${intradayReachable ? "YES" : "NO/PARTIAL"}`);
  console.log("===================================\n");
}
