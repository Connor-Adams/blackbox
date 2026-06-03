import type { DexcomReadingPayload } from "@/lib/domain/types";

type FetchImpl = typeof fetch;

/** A Dexcom v3 EGV record (subset of fields we use). */
export interface DexcomEgvRecord {
  recordId: string;
  systemTime: string; // UTC, no zone suffix
  displayTime: string;
  value: number | null;
  unit: string;
  trend?: string;
  trendRate?: number | null;
}

/** Format a Date as Dexcom's `YYYY-MM-DDThh:mm:ss` (UTC, no zone, no millis). */
export function dexcomDate(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/** Ensure a zone-less timestamp string is treated as UTC ISO. */
function asUtcIso(t: string): string {
  return new Date(`${t}Z`).toISOString();
}

/** Map a Dexcom EGV record to a DexcomReadingPayload, or null if it has no value. */
export function egvToPayload(r: DexcomEgvRecord): DexcomReadingPayload | null {
  if (r.value === null || r.value === undefined) return null;
  return {
    value: r.value,
    unit: r.unit,
    timestamp: asUtcIso(r.systemTime),
    ...(r.trend !== undefined ? { trend: r.trend } : {}),
    ...(r.trendRate !== null && r.trendRate !== undefined ? { trendRate: r.trendRate } : {}),
    recordId: r.recordId,
  };
}

/** Fetch EGV records for [startDate, endDate] (Dexcom date format). */
export async function fetchEgvs(
  accessToken: string,
  apiBase: string,
  startDate: string,
  endDate: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DexcomEgvRecord[]> {
  const url = new URL(`${apiBase}/v3/users/self/egvs`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`dexcom egv fetch failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { records?: DexcomEgvRecord[] };
  return json.records ?? [];
}
