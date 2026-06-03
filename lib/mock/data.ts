import type { DexcomReadingPayload, ManualAnnotationPayload } from "@/lib/domain/types";

const D = "2026-06-01";

function reading(idx: number, hour: number, value: number): DexcomReadingPayload {
  const hh = String(hour).padStart(2, "0");
  return { value, unit: "mmol/L", timestamp: `${D}T${hh}:00:00Z`, recordId: `normal-${idx}`, trend: "flat" };
}

/** A calm, in-range glucose day (~4.5-7.5 mmol/L). */
export const glucoseNormalDay: DexcomReadingPayload[] = [
  reading(1, 6, 5.2), reading(2, 8, 6.1), reading(3, 10, 5.8), reading(4, 12, 6.7),
  reading(5, 14, 6.0), reading(6, 16, 5.5), reading(7, 18, 6.3), reading(8, 20, 5.9),
];

/** A volatile day with spikes and a low (~3.2-13.5 mmol/L). */
export const glucoseVolatileDay: DexcomReadingPayload[] = [
  { value: 4.0, unit: "mmol/L", timestamp: `${D}T06:00:00Z`, recordId: "vol-1", trend: "flat" },
  { value: 13.5, unit: "mmol/L", timestamp: `${D}T09:00:00Z`, recordId: "vol-2", trend: "rising" },
  { value: 10.2, unit: "mmol/L", timestamp: `${D}T11:00:00Z`, recordId: "vol-3", trend: "falling" },
  { value: 3.2, unit: "mmol/L", timestamp: `${D}T14:00:00Z`, recordId: "vol-4", trend: "falling" },
  { value: 8.9, unit: "mmol/L", timestamp: `${D}T17:00:00Z`, recordId: "vol-5", trend: "rising" },
  { value: 12.1, unit: "mmol/L", timestamp: `${D}T20:00:00Z`, recordId: "vol-6", trend: "rising" },
];

/** A day of manual annotations (meal, insulin, stress, exercise). */
export const manualNotesDay: ManualAnnotationPayload[] = [
  { type: "meal", title: "Oatmeal + berries", timestamp: `${D}T07:30:00Z`, notes: "~40g carbs" },
  { type: "insulin", title: "4u bolus", timestamp: `${D}T07:35:00Z` },
  { type: "exercise", title: "30 min walk", timestamp: `${D}T12:30:00Z`, endTimestamp: `${D}T13:00:00Z` },
  { type: "stress", title: "Deadline crunch", timestamp: `${D}T15:00:00Z`, notes: "high context-switching" },
  { type: "meal", title: "Late pasta dinner", timestamp: `${D}T21:00:00Z`, notes: "big portion" },
];
