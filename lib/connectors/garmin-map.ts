/**
 * Pure mappers: Garmin Connect API JSON -> flat connector payloads.
 *
 * Shapes confirmed against the live API 2026-06-07. All intraday value arrays
 * are `[[epochMs, value], ...]`; values < 0 mean off-wrist/unmeasured and are
 * dropped. Garmin's zone-less GMT strings ("2026-06-06T04:00:00.0" /
 * "2026-06-06 19:05:00") are UTC. Every mapper is tolerant of missing fields.
 */
import type {
  GarminActivityPayload,
  GarminObservationPayload,
  GarminSleepPayload,
} from "@/lib/domain/types";

/** Parse a Garmin zone-less GMT timestamp string to epoch ms (treated as UTC). */
export function gmtToMs(s: string): number {
  return Date.parse(`${s.replace(" ", "T").replace(/\.\d+$/, "")}Z`);
}

function obs(
  metric: string,
  unit: string,
  epochMs: number,
  value: number,
  metadata?: Record<string, unknown>,
): GarminObservationPayload {
  return {
    kind: "observation",
    metric,
    value,
    unit,
    timestamp: new Date(epochMs).toISOString(),
    recordId: `${metric}:${epochMs}`,
    ...(metadata ? { metadata } : {}),
  };
}

type ValueArray = [number, number | null][];

/** dailyHeartRate: intraday heart_rate + a daily resting_heart_rate. */
export function mapHeartRate(json: {
  heartRateValues?: ValueArray;
  restingHeartRate?: number | null;
  startTimestampGMT?: string;
}): GarminObservationPayload[] {
  const out: GarminObservationPayload[] = [];
  for (const [ts, v] of json.heartRateValues ?? []) {
    if (v != null && v >= 0) out.push(obs("heart_rate", "bpm", ts, v));
  }
  if (json.restingHeartRate != null && json.startTimestampGMT) {
    out.push(obs("resting_heart_rate", "bpm", gmtToMs(json.startTimestampGMT), json.restingHeartRate));
  }
  return out;
}

/** dailyStress: intraday stress (drops sentinel negatives). */
export function mapStress(json: { stressValuesArray?: ValueArray }): GarminObservationPayload[] {
  return (json.stressValuesArray ?? [])
    .filter(([, v]) => v != null && v >= 0)
    .map(([ts, v]) => obs("stress", "score", ts, v as number));
}

/** Body-battery values array, from either dailyStress or bodyBattery/reports.
 *  Rows are `[timestamp, status, level, version?]` — the LEVEL is index 2 (index
 *  3 is a constant version). A 2-element row `[timestamp, level]` puts the level
 *  last. (Reading the last element naively picks up the version, not the level.) */
export function mapBodyBattery(
  reports: { bodyBatteryValuesArray?: (number | string | null)[][] }[],
): GarminObservationPayload[] {
  const out: GarminObservationPayload[] = [];
  for (const report of reports ?? []) {
    for (const row of report.bodyBatteryValuesArray ?? []) {
      if (row.length < 2) continue;
      const ts = row[0];
      const level = row.length >= 3 ? row[2] : row[1];
      if (typeof ts === "number" && typeof level === "number") out.push(obs("body_battery", "score", ts, level));
    }
  }
  return out;
}

/** daily/spo2: hourly SpO2 averages. */
export function mapSpo2(json: { spO2HourlyAverages?: ValueArray }): GarminObservationPayload[] {
  return (json.spO2HourlyAverages ?? [])
    .filter(([, v]) => v != null && v >= 0)
    .map(([ts, v]) => obs("spo2", "%", ts, v as number));
}

/** daily/respiration: intraday breaths-per-minute (drops sentinel negatives). */
export function mapRespiration(json: { respirationValuesArray?: ValueArray }): GarminObservationPayload[] {
  return (json.respirationValuesArray ?? [])
    .filter(([, v]) => v != null && v >= 0)
    .map(([ts, v]) => obs("respiration", "brpm", ts, v as number));
}

/** hrv-service/hrv: per-reading HRV (ms). */
export function mapHrv(json: {
  hrvReadings?: { hrvValue?: number; readingTimeGMT?: string }[];
}): GarminObservationPayload[] {
  const out: GarminObservationPayload[] = [];
  for (const r of json.hrvReadings ?? []) {
    if (r.hrvValue != null && r.readingTimeGMT) out.push(obs("hrv", "ms", gmtToMs(r.readingTimeGMT), r.hrvValue));
  }
  return out;
}

/** dailySummaryChart: 15-minute step buckets. */
export function mapSteps(buckets: { startGMT?: string; steps?: number }[]): GarminObservationPayload[] {
  const out: GarminObservationPayload[] = [];
  for (const b of buckets ?? []) {
    if (b.startGMT && b.steps != null) out.push(obs("steps", "count", gmtToMs(b.startGMT), b.steps));
  }
  return out;
}

/** usersummary daily: daily floors, intensity minutes, active calories. */
export function mapDailySummary(json: {
  floorsAscended?: number;
  moderateIntensityMinutes?: number;
  vigorousIntensityMinutes?: number;
  activeKilocalories?: number;
  wellnessStartTimeGmt?: string;
}): GarminObservationPayload[] {
  if (!json.wellnessStartTimeGmt) return [];
  const at = gmtToMs(json.wellnessStartTimeGmt);
  const out: GarminObservationPayload[] = [];
  if (json.floorsAscended != null) out.push(obs("floors", "count", at, json.floorsAscended));
  if (json.moderateIntensityMinutes != null || json.vigorousIntensityMinutes != null) {
    const im = (json.moderateIntensityMinutes ?? 0) + 2 * (json.vigorousIntensityMinutes ?? 0);
    out.push(obs("intensity_minutes", "min", at, im));
  }
  if (json.activeKilocalories != null) out.push(obs("calories", "kcal", at, json.activeKilocalories));
  return out;
}

/** trainingstatus/aggregated: most-recent VO2 max. */
export function mapVo2Max(json: {
  mostRecentVO2Max?: { generic?: { vo2MaxPreciseValue?: number; vo2MaxValue?: number; calendarDate?: string } };
}): GarminObservationPayload[] {
  const g = json.mostRecentVO2Max?.generic;
  const value = g?.vo2MaxPreciseValue ?? g?.vo2MaxValue;
  if (value == null || !g?.calendarDate) return [];
  return [obs("vo2max", "ml/kg/min", gmtToMs(`${g.calendarDate}T00:00:00`), value)];
}

/** trainingreadiness: readiness score(s) for the day. */
export function mapTrainingReadiness(arr: { score?: number; timestamp?: string }[]): GarminObservationPayload[] {
  const out: GarminObservationPayload[] = [];
  for (const r of arr ?? []) {
    if (r.score != null && r.timestamp) out.push(obs("training_readiness", "score", gmtToMs(r.timestamp), r.score));
  }
  return out;
}

/** activities search: each activity -> a workout timeline event. */
export function mapActivities(arr: {
  activityId?: number | string;
  activityName?: string;
  activityType?: { typeKey?: string };
  startTimeGMT?: string;
  duration?: number;
  distance?: number;
  calories?: number;
  averageHR?: number;
  maxHR?: number;
  elevationGain?: number;
}[]): GarminActivityPayload[] {
  const out: GarminActivityPayload[] = [];
  for (const a of arr ?? []) {
    if (a.activityId == null || !a.startTimeGMT) continue;
    const startMs = gmtToMs(a.startTimeGMT);
    const durationSeconds = Math.round(a.duration ?? 0);
    out.push({
      kind: "activity",
      recordId: `activity:${a.activityId}`,
      activityType: a.activityType?.typeKey ?? "unknown",
      title: a.activityName ?? "Activity",
      startTimestamp: new Date(startMs).toISOString(),
      endTimestamp: new Date(startMs + durationSeconds * 1000).toISOString(),
      metadata: {
        ...(a.distance != null ? { distanceMeters: a.distance } : {}),
        durationSeconds,
        ...(a.calories != null ? { calories: a.calories } : {}),
        ...(a.averageHR != null ? { averageHR: a.averageHR } : {}),
        ...(a.maxHR != null ? { maxHR: a.maxHR } : {}),
        ...(a.elevationGain != null ? { elevationGain: a.elevationGain } : {}),
      },
    });
  }
  return out;
}

/** dailySleepData: a sleep span + sleep_duration with stage breakdown. */
export function mapSleep(json: {
  dailySleepDTO?: {
    sleepTimeSeconds?: number;
    sleepStartTimestampGMT?: number;
    sleepEndTimestampGMT?: number;
    deepSleepSeconds?: number;
    lightSleepSeconds?: number;
    remSleepSeconds?: number;
    awakeSleepSeconds?: number;
    calendarDate?: string;
  };
}): GarminSleepPayload | null {
  const d = json.dailySleepDTO;
  if (!d || d.sleepStartTimestampGMT == null || d.sleepEndTimestampGMT == null || !d.calendarDate) return null;
  const stages: Record<string, number> = {};
  if (d.deepSleepSeconds != null) stages.deep = d.deepSleepSeconds;
  if (d.lightSleepSeconds != null) stages.light = d.lightSleepSeconds;
  if (d.remSleepSeconds != null) stages.rem = d.remSleepSeconds;
  if (d.awakeSleepSeconds != null) stages.awake = d.awakeSleepSeconds;
  return {
    kind: "sleep",
    recordId: `sleep:${d.calendarDate}`,
    startTimestamp: new Date(d.sleepStartTimestampGMT).toISOString(),
    endTimestamp: new Date(d.sleepEndTimestampGMT).toISOString(),
    durationSeconds: d.sleepTimeSeconds ?? 0,
    ...(Object.keys(stages).length ? { stages } : {}),
  };
}
