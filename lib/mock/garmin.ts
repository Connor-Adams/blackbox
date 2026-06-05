import type { GarminPayload, GarminObservationPayload } from "@/lib/domain/types";

const D = "2026-06-01";

function obs(metric: string, unit: string, hour: number, value: number): GarminObservationPayload {
  const ts = `${D}T${String(hour).padStart(2, "0")}:00:00Z`;
  return { kind: "observation", metric, value, unit, timestamp: ts, recordId: `${metric}:${Date.parse(ts)}` };
}

/** A mock Garmin day: intraday HR/stress/body_battery/spo2 + daily rollups,
 *  one workout, one sleep. Flows through the connector's mock branch + seed. */
export const garminMockDay: GarminPayload[] = [
  ...[6, 9, 12, 15, 18, 21].map((h, i) => obs("heart_rate", "bpm", h, 58 + i * 4)),
  ...[6, 12, 18].map((h) => obs("stress", "score", h, 30 + h)),
  ...[6, 12, 18, 22].map((h, i) => obs("body_battery", "score", h, 80 - i * 15)),
  obs("spo2", "%", 3, 96),
  obs("resting_heart_rate", "bpm", 6, 52),
  obs("steps", "count", 23, 8421),
  obs("vo2max", "ml/kg/min", 6, 48),
  {
    kind: "activity", recordId: "garmin-act-1", activityType: "running", title: "Morning Run",
    startTimestamp: `${D}T06:45:00Z`, endTimestamp: `${D}T07:23:00Z`,
    metadata: { distanceMeters: 7600, durationSeconds: 2280, calories: 540 },
  },
  {
    kind: "sleep", recordId: `sleep:${D}`,
    startTimestamp: `2026-05-31T23:05:00Z`, endTimestamp: `${D}T06:35:00Z`,
    durationSeconds: 27000, stages: { deep: 6600, light: 14400, rem: 4800, awake: 1200 },
  },
];
