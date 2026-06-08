import { describe, it, expect } from "vitest";
import {
  gmtToMs,
  mapHeartRate,
  mapStress,
  mapBodyBattery,
  mapSpo2,
  mapRespiration,
  mapHrv,
  mapSteps,
  mapDailySummary,
  mapVo2Max,
  mapTrainingReadiness,
  mapActivities,
  mapSleep,
  mapWeight,
  mapRacePredictions,
  mapEnduranceScore,
  mapFitnessAge,
  mapSleepScore,
} from "@/lib/connectors/garmin-map";

describe("gmtToMs", () => {
  it("treats Garmin zone-less GMT strings as UTC", () => {
    expect(gmtToMs("2026-06-06T04:00:00.0")).toBe(Date.parse("2026-06-06T04:00:00Z"));
    expect(gmtToMs("2026-06-06 19:05:00")).toBe(Date.parse("2026-06-06T19:05:00Z"));
  });
});

describe("mapHeartRate", () => {
  it("maps intraday values + a daily resting HR, dropping nulls/negatives", () => {
    const out = mapHeartRate({
      heartRateValues: [[1780718400000, 86], [1780718520000, null], [1780718640000, -1]],
      restingHeartRate: 56,
      startTimestampGMT: "2026-06-06T04:00:00.0",
    });
    expect(out).toEqual([
      { kind: "observation", metric: "heart_rate", value: 86, unit: "bpm", timestamp: "2026-06-06T04:00:00.000Z", recordId: "heart_rate:1780718400000" },
      { kind: "observation", metric: "resting_heart_rate", value: 56, unit: "bpm", timestamp: new Date(gmtToMs("2026-06-06T04:00:00.0")).toISOString(), recordId: `resting_heart_rate:${gmtToMs("2026-06-06T04:00:00.0")}` },
    ]);
  });
});

describe("mapStress / mapSpo2 / mapRespiration", () => {
  it("drops sentinel negatives", () => {
    expect(mapStress({ stressValuesArray: [[1, 71], [2, -1]] })).toHaveLength(1);
    expect(mapStress({ stressValuesArray: [[1, 71]] })[0]).toMatchObject({ metric: "stress", value: 71, unit: "score" });
    expect(mapSpo2({ spO2HourlyAverages: [[1780718400000, 97]] })[0]).toMatchObject({ metric: "spo2", value: 97, unit: "%" });
    expect(mapRespiration({ respirationValuesArray: [[1, 19], [2, -1]] })).toHaveLength(1);
  });
});

describe("mapBodyBattery", () => {
  it("reads the level at index 2 of a 4-element dailyStress row [ts, status, level, version]", () => {
    // The 4th element (version, constant 3) must NOT be mistaken for the level.
    const out = mapBodyBattery([{ bodyBatteryValuesArray: [[1780718400000, "MEASURED", 5, 3], [1780761600000, "MEASURED", 36, 3]] }]);
    expect(out.map((o) => o.value)).toEqual([5, 36]);
    expect(out[0]).toMatchObject({ metric: "body_battery", unit: "score", recordId: "body_battery:1780718400000" });
  });
  it("reads the level at index 2 of a 3-element reports row [ts, status, level]", () => {
    const out = mapBodyBattery([{ bodyBatteryValuesArray: [[1780718400000, "ACTIVE", 73]] }]);
    expect(out[0]).toMatchObject({ metric: "body_battery", value: 73 });
  });
});

describe("mapHrv", () => {
  it("maps each reading to an hrv observation", () => {
    const out = mapHrv({ hrvReadings: [{ hrvValue: 40, readingTimeGMT: "2026-06-06T07:13:29.0" }] });
    expect(out[0]).toMatchObject({ metric: "hrv", value: 40, unit: "ms" });
    expect(out[0].timestamp).toBe(new Date(gmtToMs("2026-06-06T07:13:29.0")).toISOString());
  });
});

describe("mapSteps", () => {
  it("maps 15-minute buckets to step observations", () => {
    const out = mapSteps([{ startGMT: "2026-06-06T04:00:00.0", steps: 9 }, { startGMT: "2026-06-06T04:15:00.0", steps: 0 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ metric: "steps", value: 9, unit: "count" });
  });
});

describe("mapDailySummary", () => {
  it("derives floors, weighted intensity minutes, and active calories", () => {
    const out = mapDailySummary({
      floorsAscended: 1.74475,
      moderateIntensityMinutes: 7,
      vigorousIntensityMinutes: 2,
      activeKilocalories: 1031,
      wellnessStartTimeGmt: "2026-06-06T04:00:00.0",
    });
    expect(out.find((o) => o.metric === "floors")).toMatchObject({ value: 1.74475, unit: "count" });
    expect(out.find((o) => o.metric === "intensity_minutes")).toMatchObject({ value: 11, unit: "min" }); // 7 + 2*2
    expect(out.find((o) => o.metric === "calories")).toMatchObject({ value: 1031, unit: "kcal" });
  });
});

describe("mapVo2Max", () => {
  it("reads the precise value at its own calendar date", () => {
    const out = mapVo2Max({ mostRecentVO2Max: { generic: { vo2MaxPreciseValue: 37.3, vo2MaxValue: 37, calendarDate: "2026-05-31" } } });
    expect(out[0]).toMatchObject({ metric: "vo2max", value: 37.3, unit: "ml/kg/min" });
    expect(out[0].timestamp).toBe(new Date(gmtToMs("2026-05-31T00:00:00")).toISOString());
  });
});

describe("mapTrainingReadiness", () => {
  it("maps the readiness score", () => {
    const out = mapTrainingReadiness([{ score: 9, timestamp: "2026-06-06T20:05:43.0" }]);
    expect(out[0]).toMatchObject({ metric: "training_readiness", value: 9, unit: "score" });
  });
});

describe("mapActivities", () => {
  it("maps an activity to a workout payload with end = start + duration", () => {
    const out = mapActivities([{
      activityId: 23156014057, activityName: "Guelph Cycling", activityType: { typeKey: "cycling" },
      startTimeGMT: "2026-06-06 19:05:00", duration: 3452.6, distance: 12453.48, calories: 165, averageHR: 120, maxHR: 175, elevationGain: 115,
    }]);
    expect(out[0]).toMatchObject({
      kind: "activity", recordId: "activity:23156014057", activityType: "cycling", title: "Guelph Cycling",
      startTimestamp: "2026-06-06T19:05:00.000Z", endTimestamp: "2026-06-06T20:02:33.000Z",
    });
    expect(out[0].metadata).toMatchObject({ distanceMeters: 12453.48, durationSeconds: 3453, calories: 165, averageHR: 120, maxHR: 175 });
  });
});

describe("mapSleep", () => {
  it("maps the sleep DTO to a sleep span + duration + stages", () => {
    const out = mapSleep({
      dailySleepDTO: {
        sleepTimeSeconds: 19898, sleepStartTimestampGMT: 1780814443000, sleepEndTimestampGMT: 1780837341000,
        deepSleepSeconds: 1920, lightSleepSeconds: 15240, remSleepSeconds: 2760, awakeSleepSeconds: 3000, calendarDate: "2026-06-06",
      },
    });
    expect(out).toMatchObject({
      kind: "sleep", recordId: "sleep:2026-06-06", durationSeconds: 19898,
      startTimestamp: new Date(1780814443000).toISOString(), endTimestamp: new Date(1780837341000).toISOString(),
      stages: { deep: 1920, light: 15240, rem: 2760, awake: 3000 },
    });
  });
  it("returns null when the DTO is missing required fields", () => {
    expect(mapSleep({})).toBeNull();
  });
});

describe("additional metrics", () => {
  it("mapWeight converts grams to kg and skips null composition", () => {
    const out = mapWeight({
      dailyWeightSummaries: [
        { latestWeight: { weight: 80900, bodyFat: null, muscleMass: null, timestampGMT: 1780347395000, calendarDate: "2026-06-01" } },
      ],
    });
    expect(out).toEqual([
      { kind: "observation", metric: "weight", value: 80.9, unit: "kg", timestamp: new Date(1780347395000).toISOString(), recordId: "weight:1780347395000" },
    ]);
  });

  it("mapRacePredictions maps each predicted time in seconds", () => {
    const out = mapRacePredictions({ time5K: 1833, time10K: 4067, timeHalfMarathon: 9789, timeMarathon: 23482, calendarDate: "2026-06-07" });
    expect(out.map((o) => [o.metric, o.value])).toEqual([
      ["race_time_5k", 1833], ["race_time_10k", 4067], ["race_time_half_marathon", 9789], ["race_time_marathon", 23482],
    ]);
    expect(out[0].timestamp).toBe(new Date(gmtToMs("2026-06-07T12:00:00")).toISOString());
  });

  it("mapEnduranceScore reads overallScore, skipping null", () => {
    expect(mapEnduranceScore({ overallScore: 4140, calendarDate: "2026-06-07" })[0]).toMatchObject({ metric: "endurance_score", value: 4140 });
    expect(mapEnduranceScore({ overallScore: null, calendarDate: "2026-06-07" })).toEqual([]);
  });

  it("mapFitnessAge emits fitness_age (rounded) + bmi from components", () => {
    const out = mapFitnessAge({
      fitnessAge: 20.60705266103952,
      lastUpdated: "2026-06-05T00:00:00.0",
      components: { bmi: { value: 19.6, lastMeasurementDate: "2026-06-01" } },
    });
    expect(out.find((o) => o.metric === "fitness_age")).toMatchObject({ value: 20.6, unit: "yr" });
    expect(out.find((o) => o.metric === "bmi")).toMatchObject({ value: 19.6 });
  });

  it("mapSleepScore reads dailySleepDTO.sleepScores.overall.value", () => {
    const out = mapSleepScore({ dailySleepDTO: { sleepScores: { overall: { value: 61 } }, calendarDate: "2026-06-06", sleepStartTimestampGMT: 1780814443000 } });
    expect(out[0]).toMatchObject({ metric: "sleep_score", value: 61 });
    expect(mapSleepScore({ dailySleepDTO: { calendarDate: "2026-06-06" } })).toEqual([]);
  });
});
