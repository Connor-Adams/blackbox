/**
 * Garmin Connect fetch layer: replays confirmed connectapi.garmin.com endpoints
 * through an authed HttpClient and maps each to flat payloads. Endpoints + shapes
 * confirmed live 2026-06-07. Every metric is best-effort — a failure for one
 * metric on a given day is skipped, not fatal.
 */
import type { GarminPayload } from "@/lib/domain/types";
import type { GarminHttp } from "./garmin-auth";
import {
  mapActivities,
  mapBloodPressure,
  mapBodyBattery,
  mapDailySummary,
  mapEnduranceScore,
  mapFitnessAge,
  mapHeartRate,
  mapHillScore,
  mapHrv,
  mapHydration,
  mapRacePredictions,
  mapRespiration,
  mapSleep,
  mapSleepScore,
  mapSpo2,
  mapSteps,
  mapStress,
  mapTrainingReadiness,
  mapVo2Max,
  mapWeight,
} from "./garmin-map";

const API = "https://connectapi.garmin.com";
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

/** Resolve the account's displayName (a UUID) — required by per-user endpoints. */
export async function getDisplayName(http: GarminHttp): Promise<string> {
  const p = await http.get<{ displayName?: string }>(`${API}/userprofile-service/socialProfile`);
  if (!p.displayName) throw new Error("garmin: could not resolve displayName");
  return p.displayName;
}

/** Inclusive YYYY-MM-DD list for the sync window: last 7 days on first sync,
 *  else from lastSyncAt forward. */
export function syncDates(lastSyncAt: Date | null, now: Date): string[] {
  const startMs = lastSyncAt ? lastSyncAt.getTime() : now.getTime() - 7 * DAY_MS;
  const dates: string[] = [];
  for (let t = startMs; t <= now.getTime(); t += DAY_MS) dates.push(isoDate(new Date(t)));
  return [...new Set(dates)];
}

/** Fetch one day's per-day metrics as payloads (no activities — those are
 *  fetched once per window by `fetchActivities`). */
export async function fetchDay(http: GarminHttp, displayName: string, date: string): Promise<GarminPayload[]> {
  const dn = displayName;
  const out: GarminPayload[] = [];
  const grab = async (fn: () => Promise<GarminPayload[] | GarminPayload | null>) => {
    try {
      const r = await fn();
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    } catch {
      /* metric unavailable for this day — skip */
    }
  };

  await grab(async () => mapHeartRate(await http.get(`${API}/wellness-service/wellness/dailyHeartRate/${dn}?date=${date}`)));
  // dailyStress carries both the stress series and a dense body-battery series.
  await grab(async () => {
    const json = await http.get<{
      stressValuesArray?: [number, number | null][];
      bodyBatteryValuesArray?: (number | string | null)[][];
    }>(`${API}/wellness-service/wellness/dailyStress/${date}`);
    return [...mapStress(json), ...mapBodyBattery([{ bodyBatteryValuesArray: json.bodyBatteryValuesArray }])];
  });
  await grab(async () => mapSpo2(await http.get(`${API}/wellness-service/wellness/daily/spo2/${date}`)));
  await grab(async () => mapRespiration(await http.get(`${API}/wellness-service/wellness/daily/respiration/${date}`)));
  await grab(async () => mapHrv(await http.get(`${API}/hrv-service/hrv/${date}`)));
  await grab(async () => mapSteps(await http.get(`${API}/wellness-service/wellness/dailySummaryChart/${dn}?date=${date}`)));
  await grab(async () => mapDailySummary(await http.get(`${API}/usersummary-service/usersummary/daily/${dn}?calendarDate=${date}`)));
  await grab(async () => mapVo2Max(await http.get(`${API}/metrics-service/metrics/trainingstatus/aggregated/${date}`)));
  await grab(async () => mapTrainingReadiness(await http.get(`${API}/metrics-service/metrics/trainingreadiness/${date}`)));
  await grab(async () => {
    const sleep = await http.get<Parameters<typeof mapSleep>[0] & Parameters<typeof mapSleepScore>[0]>(
      `${API}/wellness-service/wellness/dailySleepData/${dn}?date=${date}&nonSleepBufferMinutes=60`,
    );
    const s = mapSleep(sleep);
    return [...(s ? [s] : []), ...mapSleepScore(sleep)];
  });
  await grab(async () => mapEnduranceScore(await http.get(`${API}/metrics-service/metrics/endurancescore?calendarDate=${date}`)));
  await grab(async () => mapHillScore(await http.get(`${API}/metrics-service/metrics/hillscore?startDate=${date}&endDate=${date}&aggregation=daily`)));
  await grab(async () => mapFitnessAge(await http.get(`${API}/fitnessage-service/fitnessage/${date}`)));
  await grab(async () => mapHydration(await http.get(`${API}/usersummary-service/usersummary/hydration/daily/${date}`)));
  return out;
}

/** Window-scoped metrics fetched once per sync (not per day): body weight +
 *  composition, blood pressure, and the latest race-time predictions. */
export async function fetchWindowExtras(
  http: GarminHttp,
  displayName: string,
  startDate: string,
  endDate: string,
): Promise<GarminPayload[]> {
  const out: GarminPayload[] = [];
  const grab = async (fn: () => Promise<GarminPayload[]>) => {
    try {
      out.push(...(await fn()));
    } catch {
      /* metric unavailable — skip */
    }
  };
  await grab(async () => mapWeight(await http.get(`${API}/weight-service/weight/range/${startDate}/${endDate}?includeAll=true`)));
  await grab(async () => mapBloodPressure(await http.get(`${API}/bloodpressure-service/bloodpressure/range/${startDate}/${endDate}?includeAll=true`)));
  await grab(async () => mapRacePredictions(await http.get(`${API}/metrics-service/metrics/racepredictions/latest/${displayName}`)));
  return out;
}

/** Fetch activities overlapping the [startDate, endDate] window (one call). */
export async function fetchActivities(http: GarminHttp, startDate: string, endDate: string): Promise<GarminPayload[]> {
  try {
    const acts = await http.get<Parameters<typeof mapActivities>[0]>(
      `${API}/activitylist-service/activities/search/activities?startDate=${startDate}&endDate=${endDate}&start=0&limit=50`,
    );
    return mapActivities(acts);
  } catch {
    return [];
  }
}
