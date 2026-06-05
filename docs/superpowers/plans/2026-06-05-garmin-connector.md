# Garmin Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `garmin` source connector that ingests Garmin Connect health + activity data (full intraday) through Blackbox's existing ingest spine, with a mandatory mock fallback and a best-effort live path via `garmin-connect-client`.

**Architecture:** The connector emits flat per-sample payloads (`GarminObservationPayload | GarminActivityPayload | GarminSleepPayload`); the existing `ingestRawEvents` pipeline builds `raw_event`s and `normalize()` maps them to `observation` / `timeline_event`. Live auth uses `garmin-connect-client`'s device-identity OAuth2 (persisted session bundle in `source_connection.metadata.garmin`, lib auto-refreshes). Live fetch replays Garmin Connect endpoints through the lib's authed `HttpClient`. Mock mode (seeded fixtures) runs with no account.

**Tech Stack:** Next.js App Router · TypeScript · Postgres · Drizzle · Vitest · `garmin-connect-client@2.0.0` · `luxon`.

**Phasing:** Tasks 1–4 (data model + mock connector) are independently shippable — they put a mock Garmin day on `/timeline` with no account. Tasks 5–7 (live auth + fetch + UI) layer the real path on top. Task 0 (spike) gates the live endpoint list and is blocked on real credentials; Tasks 1–4 do not depend on it.

---

## Task 0: Live-first spike (GATE for live path; blocked on creds)

Already scaffolded (`scripts/garmin-spike.ts`, `pnpm garmin:spike`). Run it with real creds in `.env.local`, record results into this plan's appendix before implementing Tasks 5–6.

- [ ] **Step 1: Provide creds.** In gitignored `.env.local`: `GARMIN_EMAIL=…` / `GARMIN_PASSWORD=…`.
- [ ] **Step 2: Run.** `pnpm garmin:spike`
- [ ] **Step 3: Record** which of the ✅/❌ endpoints returned 200 and paste truncated JSON shapes into **Appendix A** below. These confirm/replace the endpoint URLs in Task 5.

Do **not** block Tasks 1–4 on this.

---

## Task 1: Domain types + creds bundle

**Files:**
- Modify: `lib/connectors/types.ts`
- Modify: `lib/domain/types.ts`

- [ ] **Step 1: Add `GarminCreds` + `SourceCreds` to `lib/connectors/types.ts`.**

After the `DexcomCreds` interface, add:

```ts
/** Persisted garmin-connect-client session bundle (its PersistedSession).
 *  Stored in source_connection.metadata.garmin. The lib auto-refreshes the
 *  OAuth2 token using refresh_token + diClientId — no OAuth1 token. */
export interface GarminCreds {
  cookies?: string;
  oauth2Token: {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
    expires_at?: number;
    refresh_token_expires_at?: number;
  };
  diClientId: string;
}

/** Any source's persisted credential bundle. */
export type SourceCreds = DexcomCreds | GarminCreds;
```

(The `ConnectorSyncContext.saveCredentials` signature is widened to `SourceCreds` in Task 2, atomically with its callers — doing it here would break `tsc` until then.)

- [ ] **Step 2: Add Garmin payload types to `lib/domain/types.ts`.**

Append:

```ts
/** Garmin connector payloads. One observation payload per intraday sample;
 *  `recordId` is the raw_event dedupe key (stable across re-syncs). */
export interface GarminObservationPayload {
  kind: "observation";
  metric: string; // an ObservationMetric
  value: number;
  unit: string;
  timestamp: string; // ISO 8601
  recordId: string; // `${metric}:${epochMs}`
  metadata?: Record<string, unknown>;
}

export interface GarminActivityPayload {
  kind: "activity";
  recordId: string; // garmin activityId
  activityType: string;
  title: string;
  startTimestamp: string; // ISO 8601
  endTimestamp: string; // ISO 8601
  metadata?: Record<string, unknown>; // distance, durationSeconds, calories…
}

export interface GarminSleepPayload {
  kind: "sleep";
  recordId: string; // `sleep:${YYYY-MM-DD}`
  startTimestamp: string;
  endTimestamp: string;
  durationSeconds: number;
  stages?: Record<string, number>; // light/deep/rem/awake seconds
  metadata?: Record<string, unknown>;
}

export type GarminPayload =
  | GarminObservationPayload
  | GarminActivityPayload
  | GarminSleepPayload;
```

- [ ] **Step 3: Typecheck.** Run: `pnpm exec tsc --noEmit` — Expected: PASS (no callers broken; `DexcomCreds` is a member of `SourceCreds`).

- [ ] **Step 4: Commit.**

```bash
git add lib/connectors/types.ts lib/domain/types.ts
git commit -m "feat(garmin): add GarminCreds and Garmin payload types"
```

---

## Task 2: Extend metric union + generalize saveCredentials wiring

**Files:**
- Modify: `lib/db/schema.ts:25-29`
- Modify: `lib/connectors/sync.ts`
- Modify: `lib/db/sources.ts:19-34`

- [ ] **Step 1: Add Garmin metrics to the union in `lib/db/schema.ts`.**

Replace the `observationMetrics` array (lines 25-28) with:

```ts
export const observationMetrics = [
  "glucose", "cash_balance", "daily_spend", "transaction_amount",
  "heart_rate", "hrv", "stress", "steps", "sleep_duration", "body_battery",
  "resting_heart_rate", "spo2", "respiration", "vo2max",
  "floors", "intensity_minutes", "calories", "training_readiness",
] as const;
```

(Text column — no DB migration needed.)

- [ ] **Step 2: Widen `ConnectorSyncContext.saveCredentials` + generalize `SyncStore.saveCredentials`.**

First, in `lib/connectors/types.ts`, widen the context method (was `DexcomCreds`):

```ts
  saveCredentials(creds: SourceCreds): Promise<void>;
```

Then in `lib/connectors/sync.ts`, change the import line 2 to also pull `SourceCreds`, and add `SourceType`:

```ts
import type { Connector, ConnectorSyncContext, SourceCreds, SyncConnection } from "./types";
import type { SourceType } from "@/lib/db/schema";
```

Change the `SyncStore.saveCredentials` member (line 6) to:

```ts
  saveCredentials(connectionId: string, sourceType: SourceType, creds: SourceCreds): Promise<void>;
```

Change the ctx binding inside `executeSync` (line 31) to:

```ts
      saveCredentials: (creds) => store.saveCredentials(conn.id, conn.sourceType, creds),
```

- [ ] **Step 3: Update `DbSyncStore.saveCredentials` in `lib/db/sources.ts`.**

Replace the method (lines 22-30) with a namespaced write, and update the import on line 8 to `SourceCreds`:

```ts
import type { SourceCreds, SyncConnection } from "@/lib/connectors/types";
```

```ts
  async saveCredentials(connectionId: string, sourceType: string, creds: SourceCreds): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}), [sourceType]: creds };
    await this.db.update(sourceConnection).set({ metadata }).where(eq(sourceConnection.id, connectionId));
  }
```

(For `dexcom`, `sourceType` is `"dexcom"` → writes `metadata.dexcom`, identical to before.)

- [ ] **Step 4: Typecheck + existing tests.** Run: `pnpm exec tsc --noEmit && pnpm test` — Expected: PASS (dexcom behavior unchanged).

- [ ] **Step 5: Commit.**

```bash
git add lib/db/schema.ts lib/connectors/sync.ts lib/db/sources.ts
git commit -m "feat(garmin): add Garmin observation metrics; namespace saveCredentials by sourceType"
```

---

## Task 3: Ingest + normalize for `garmin` (TDD)

**Files:**
- Modify: `lib/domain/ingest.ts:36-52`
- Modify: `lib/domain/normalize.ts`
- Test: `lib/domain/normalize.test.ts` (create if absent; else append)

- [ ] **Step 1: Write failing tests in `lib/domain/normalize.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/domain/normalize";
import type { RawEventInput } from "@/lib/domain/types";

function raw(payload: unknown): RawEventInput {
  return { id: "r1", userId: "u", sourceConnectionId: "c", sourceType: "garmin", sourceRecordId: "x", occurredAt: new Date("2026-06-01T08:00:00Z"), payload };
}

describe("normalize garmin", () => {
  it("maps an observation payload to one observation", () => {
    const out = normalize(raw({ kind: "observation", metric: "heart_rate", value: 61, unit: "bpm", timestamp: "2026-06-01T08:00:00Z", recordId: "heart_rate:1" }));
    expect(out.observations).toEqual([
      { userId: "u", rawEventId: "r1", sourceType: "garmin", metric: "heart_rate", value: 61, unit: "bpm", observedAt: new Date("2026-06-01T08:00:00Z"), metadata: {} },
    ]);
    expect(out.timelineEvents).toEqual([]);
  });

  it("maps an activity payload to a workout timeline event", () => {
    const out = normalize(raw({ kind: "activity", recordId: "a1", activityType: "running", title: "Morning Run", startTimestamp: "2026-06-01T06:00:00Z", endTimestamp: "2026-06-01T06:40:00Z", metadata: { distance: 8000 } }));
    expect(out.observations).toEqual([]);
    expect(out.timelineEvents).toEqual([
      { userId: "u", rawEventId: "r1", sourceType: "garmin", eventType: "workout", title: "Morning Run", description: null, startedAt: new Date("2026-06-01T06:00:00Z"), endedAt: new Date("2026-06-01T06:40:00Z"), metadata: { activityType: "running", distance: 8000 } },
    ]);
  });

  it("maps a sleep payload to a sleep event + sleep_duration observation", () => {
    const out = normalize(raw({ kind: "sleep", recordId: "sleep:2026-06-01", startTimestamp: "2026-05-31T23:00:00Z", endTimestamp: "2026-06-01T07:00:00Z", durationSeconds: 28800, stages: { deep: 7200, rem: 5400 } }));
    expect(out.observations).toHaveLength(1);
    expect(out.observations[0]).toMatchObject({ metric: "sleep_duration", value: 28800, unit: "s", metadata: { deep: 7200, rem: 5400 } });
    expect(out.timelineEvents[0]).toMatchObject({ eventType: "sleep", title: "Sleep", endedAt: new Date("2026-06-01T07:00:00Z") });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `pnpm test normalize` — Expected: FAIL (garmin returns EMPTY).

- [ ] **Step 3: Implement `normalizeGarmin` in `lib/domain/normalize.ts`.**

Add the import for the payload type at the top:

```ts
import type { GarminPayload } from "@/lib/domain/types";
```

Add the function before the exported `normalize`:

```ts
function normalizeGarmin(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as GarminPayload;
  if (p.kind === "observation") {
    return {
      observations: [{
        userId: raw.userId, rawEventId: raw.id, sourceType: "garmin",
        metric: p.metric, value: p.value, unit: p.unit,
        observedAt: new Date(p.timestamp), metadata: p.metadata ?? {},
      }],
      timelineEvents: [],
    };
  }
  if (p.kind === "activity") {
    return {
      observations: [],
      timelineEvents: [{
        userId: raw.userId, rawEventId: raw.id, sourceType: "garmin",
        eventType: "workout", title: p.title, description: null,
        startedAt: new Date(p.startTimestamp), endedAt: new Date(p.endTimestamp),
        metadata: { activityType: p.activityType, ...(p.metadata ?? {}) },
      }],
    };
  }
  return {
    observations: [{
      userId: raw.userId, rawEventId: raw.id, sourceType: "garmin",
      metric: "sleep_duration", value: p.durationSeconds, unit: "s",
      observedAt: new Date(p.startTimestamp), metadata: p.stages ?? {},
    }],
    timelineEvents: [{
      userId: raw.userId, rawEventId: raw.id, sourceType: "garmin",
      eventType: "sleep", title: "Sleep", description: null,
      startedAt: new Date(p.startTimestamp), endedAt: new Date(p.endTimestamp),
      metadata: { durationSeconds: p.durationSeconds, ...(p.stages ?? {}) },
    }],
  };
}
```

Add the case to the `switch` in `normalize`:

```ts
    case "garmin":
      return normalizeGarmin(raw);
```

- [ ] **Step 4: Add the `garmin` case to `extractRawMeta` in `lib/domain/ingest.ts`.**

Add to the imports (line 2-9 block): `GarminPayload`. Add this case before `default:` (line 49):

```ts
    case "garmin": {
      const p = payload as GarminPayload;
      const ts = p.kind === "observation" ? p.timestamp : p.startTimestamp;
      return { sourceRecordId: p.recordId, occurredAt: new Date(ts) };
    }
```

- [ ] **Step 5: Run — expect PASS.** Run: `pnpm test normalize` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/domain/normalize.ts lib/domain/ingest.ts lib/domain/normalize.test.ts
git commit -m "feat(garmin): normalize + ingest Garmin observation/activity/sleep payloads"
```

---

## Task 4: Mock fixtures + connector (mock path) + registry + seed (TDD)

**Files:**
- Modify: `lib/constants.ts`
- Create: `lib/mock/garmin.ts`
- Create: `lib/connectors/garmin.ts`
- Modify: `lib/connectors/index.ts`
- Modify: `scripts/seed.ts`
- Test: `lib/connectors/garmin.test.ts`

- [ ] **Step 1: Add connection ids to `lib/constants.ts`.**

```ts
export const SEED_GARMIN_CONNECTION_ID = "00000000-0000-4000-8000-000000000013";
export const LIVE_GARMIN_CONNECTION_ID = "00000000-0000-4000-8000-000000000021";
```

- [ ] **Step 2: Create `lib/mock/garmin.ts`** (a compact mock day: a few intraday samples per metric + one workout + one sleep — enough to render, not thousands).

```ts
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
    startTimestamp: `${D}T06:10:00Z`, endTimestamp: `${D}T06:48:00Z`,
    metadata: { distanceMeters: 7600, durationSeconds: 2280, calories: 540 },
  },
  {
    kind: "sleep", recordId: `sleep:${D}`,
    startTimestamp: `2026-05-31T23:05:00Z`, endTimestamp: `${D}T06:35:00Z`,
    durationSeconds: 27000, stages: { deep: 6600, light: 14400, rem: 4800, awake: 1200 },
  },
];
```

- [ ] **Step 3: Write failing connector test `lib/connectors/garmin.test.ts`.**

```ts
import { describe, it, expect, vi } from "vitest";
import { garminConnector } from "@/lib/connectors/garmin";
import type { ConnectorSyncContext, SyncConnection } from "@/lib/connectors/types";
import { garminMockDay } from "@/lib/mock/garmin";

function ctxFor(connection: Partial<SyncConnection>, now: Date): ConnectorSyncContext {
  return {
    connection: { id: "c", userId: "u", sourceType: "garmin", metadata: {}, lastSyncAt: null, ...connection },
    now,
    saveCredentials: vi.fn(async () => {}),
  };
}

describe("garminConnector (mock branch)", () => {
  it("emits the mock day when the connection has no garmin creds", async () => {
    const out = await garminConnector.sync(ctxFor({ metadata: {} }, new Date("2026-06-02T00:00:00Z")));
    expect(out).toEqual(garminMockDay);
    expect(out.length).toBe(garminMockDay.length);
  });
});
```

- [ ] **Step 4: Run — expect FAIL.** Run: `pnpm test garmin` — Expected: FAIL (module missing).

- [ ] **Step 5: Implement `lib/connectors/garmin.ts` (mock branch only for now).**

```ts
import type { Connector, ConnectorSyncContext, GarminCreds } from "./types";
import { garminMockDay } from "@/lib/mock/garmin";

function readCreds(metadata: Record<string, unknown>): GarminCreds | null {
  const c = metadata.garmin as GarminCreds | undefined;
  return c?.oauth2Token?.access_token ? c : null;
}

/** Garmin connector. Mock (seeded) when the connection has no credentials;
 *  live fetch (Task 5) when it does. */
export const garminConnector: Connector = {
  sourceType: "garmin",
  async sync(ctx: ConnectorSyncContext): Promise<unknown[]> {
    const creds = readCreds(ctx.connection.metadata);
    if (!creds) {
      return garminMockDay;
    }
    // Live path implemented in Task 5.
    throw new Error("garmin live sync not yet implemented");
  },
};
```

- [ ] **Step 6: Register in `lib/connectors/index.ts`.**

Add import + registry entry:

```ts
import { garminConnector } from "./garmin";
```
```ts
const REGISTRY: Partial<Record<string, Connector>> = {
  dexcom: dexcomConnector,
  cashflow: cashflowConnector,
  garmin: garminConnector,
};
```

- [ ] **Step 7: Seed a mock Garmin connection in `scripts/seed.ts`.**

Add `SEED_GARMIN_CONNECTION_ID` to the constants import and `garminMockDay` import; then add:

```ts
  const garmin = await ensureSourceConnection({ id: SEED_GARMIN_CONNECTION_ID, sourceType: "garmin", displayName: "Garmin (mock)" });
  const garResult = await ingestRawEvents(store, garmin, garminMockDay);
```

and include `garmin: garResult` in the final `console.log`.

- [ ] **Step 8: Run — expect PASS.** Run: `pnpm test garmin && pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 9: Manual verify (optional, needs DB).** `pnpm db:seed` then load `/timeline?date=2026-06-01` — Garmin workout, sleep, and HR/body-battery observations render alongside other sources.

- [ ] **Step 10: Commit.**

```bash
git add lib/constants.ts lib/mock/garmin.ts lib/connectors/garmin.ts lib/connectors/index.ts scripts/seed.ts lib/connectors/garmin.test.ts
git commit -m "feat(garmin): mock connector, fixtures, registry, seed"
```

**End of independently-shippable mock increment.**

---

## Task 5: Live auth + per-day fetch + mapping (TDD; reconcile endpoints with Task 0)

**Files:**
- Create: `lib/connectors/garmin-auth.ts`
- Create: `lib/connectors/garmin-api.ts`
- Create: `lib/connectors/garmin-map.ts`
- Modify: `lib/connectors/garmin.ts`
- Test: `lib/connectors/garmin-map.test.ts`

- [ ] **Step 1: `lib/connectors/garmin-auth.ts` — wrap the library.**

```ts
import { login as gccLogin, fromSession } from "garmin-connect-client";
// Deep imports: the package ships no "exports" map.
import { HttpClient } from "garmin-connect-client/dist/http-client.js";
import { GarminUrls } from "garmin-connect-client/dist/urls.js";
import type { GarminCreds } from "./types";

/** A minimal authed GET surface, so garmin-api is testable without network. */
export interface GarminHttp {
  get<T>(url: string): Promise<T>;
}

/** Log in with credentials and return the persistable session bundle. */
export async function loginGarmin(email: string, password: string): Promise<GarminCreds> {
  const result = await gccLogin({ username: email, password });
  if (result.mfaRequired) {
    throw new Error("garmin: account requires MFA, which v0 does not support");
  }
  return result.client.getSession() as unknown as GarminCreds;
}

/** Build an authed HttpClient (auto-refreshing) from a stored session. */
export function httpFromCreds(creds: GarminCreds): GarminHttp {
  // HttpClient(urls, session) — replays arbitrary connectapi endpoints with the bearer.
  return new HttpClient(new GarminUrls(), creds as never) as unknown as GarminHttp;
}

export { fromSession };
```

- [ ] **Step 2: `lib/connectors/garmin-map.ts` — pure JSON → payloads.**

> NOTE: the response shapes below follow python-garminconnect / Garmin Connect conventions; reconcile field names against the real JSON captured in **Appendix A** (Task 0). The functions are pure and unit-tested against sample JSON.

```ts
import type { GarminObservationPayload } from "@/lib/domain/types";

function ob(metric: string, unit: string, epochMs: number, value: number): GarminObservationPayload {
  return { kind: "observation", metric, value, unit, timestamp: new Date(epochMs).toISOString(), recordId: `${metric}:${epochMs}` };
}

/** Garmin daily heart rate: { heartRateValues: [[epochMs, bpm], …] }. */
export function mapHeartRate(json: { heartRateValues?: [number, number | null][] }): GarminObservationPayload[] {
  return (json.heartRateValues ?? [])
    .filter(([, v]) => v !== null)
    .map(([t, v]) => ob("heart_rate", "bpm", t, v as number));
}

/** Garmin daily stress: { stressValuesArray: [[epochMs, score], …] } (score < 0 = unmeasured). */
export function mapStress(json: { stressValuesArray?: [number, number][] }): GarminObservationPayload[] {
  return (json.stressValuesArray ?? [])
    .filter(([, v]) => v >= 0)
    .map(([t, v]) => ob("stress", "score", t, v));
}

/** Garmin body battery: { bodyBatteryValuesArray: [[epochMs, status, level], …] }. */
export function mapBodyBattery(json: { bodyBatteryValuesArray?: [number, string, number][] }): GarminObservationPayload[] {
  return (json.bodyBatteryValuesArray ?? [])
    .filter(([, , level]) => typeof level === "number")
    .map(([t, , level]) => ob("body_battery", "score", t, level));
}
```

- [ ] **Step 3: Failing tests `lib/connectors/garmin-map.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { mapHeartRate, mapStress, mapBodyBattery } from "@/lib/connectors/garmin-map";

describe("garmin-map", () => {
  it("maps heart rate values, dropping nulls", () => {
    const out = mapHeartRate({ heartRateValues: [[1717225200000, 61], [1717225260000, null]] });
    expect(out).toEqual([
      { kind: "observation", metric: "heart_rate", value: 61, unit: "bpm", timestamp: "2026-06-01T07:00:00.000Z", recordId: "heart_rate:1717225200000" },
    ]);
  });
  it("drops unmeasured stress (negative)", () => {
    expect(mapStress({ stressValuesArray: [[1717225200000, -1], [1717225200000, 22]] })).toHaveLength(1);
  });
  it("maps body battery level", () => {
    const out = mapBodyBattery({ bodyBatteryValuesArray: [[1717225200000, "ACTIVE", 73]] });
    expect(out[0]).toMatchObject({ metric: "body_battery", value: 73 });
  });
});
```

- [ ] **Step 4: Run — expect PASS** (functions exist from Step 2). Run: `pnpm test garmin-map` — Expected: PASS. (If FAIL, fix field names per Appendix A.)

- [ ] **Step 5: `lib/connectors/garmin-api.ts` — per-day fetch + window + rate-limit.**

```ts
import type { GarminPayload } from "@/lib/domain/types";
import type { GarminHttp } from "./garmin-auth";
import { mapHeartRate, mapStress, mapBodyBattery } from "./garmin-map";

const CONNECT_API = "https://connectapi.garmin.com";
const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD

/** Resolve the account's displayName (needed by per-user endpoints). */
export async function getDisplayName(http: GarminHttp): Promise<string> {
  const p = await http.get<{ displayName?: string }>(`${CONNECT_API}/userprofile-service/socialProfile`);
  if (!p.displayName) throw new Error("garmin: could not resolve displayName");
  return p.displayName;
}

/** Fetch one day's intraday metrics as flat payloads. Endpoint URLs reconciled
 *  from Appendix A. Each metric is best-effort: a failure for one metric skips it. */
export async function fetchDay(http: GarminHttp, displayName: string, date: string): Promise<GarminPayload[]> {
  const out: GarminPayload[] = [];
  const tryFetch = async <T>(url: string, map: (j: T) => GarminPayload[]) => {
    try { out.push(...map(await http.get<T>(url))); } catch { /* skip this metric for the day */ }
  };
  await tryFetch(`${CONNECT_API}/wellness-service/wellness/dailyHeartRate/${displayName}?date=${date}`, mapHeartRate);
  await tryFetch(`${CONNECT_API}/wellness-service/wellness/dailyStress/${date}`, mapStress);
  await tryFetch(`${CONNECT_API}/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`, mapBodyBattery);
  // Activities + sleep + additional metrics added here once confirmed (Appendix A).
  return out;
}

/** Inclusive list of YYYY-MM-DD strings for the sync window. */
export function syncDates(lastSyncAt: Date | null, now: Date): string[] {
  const startMs = lastSyncAt ? lastSyncAt.getTime() : now.getTime() - 7 * DAY_MS;
  const dates: string[] = [];
  for (let t = startMs; t <= now.getTime(); t += DAY_MS) dates.push(iso(new Date(t)));
  return dates;
}
```

- [ ] **Step 6: Wire the live branch in `lib/connectors/garmin.ts`.**

Replace the `throw new Error("garmin live sync not yet implemented")` with:

```ts
    const http = httpFromCreds(creds);
    const displayName = await getDisplayName(http);
    const dates = syncDates(ctx.connection.lastSyncAt, ctx.now);
    const payloads: unknown[] = [];
    for (const date of dates) {
      payloads.push(...(await fetchDay(http, displayName, date)));
      if (dates.length > 1) await sleep(RATE_LIMIT_MS);
    }
    return payloads;
```

Add imports + constants at the top of `garmin.ts`:

```ts
import { httpFromCreds } from "./garmin-auth";
import { fetchDay, getDisplayName, syncDates } from "./garmin-api";

const RATE_LIMIT_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 7: Add a `syncDates` unit test** to `lib/connectors/garmin.test.ts`:

```ts
import { syncDates } from "@/lib/connectors/garmin-api";

describe("syncDates", () => {
  it("defaults to a 7-day window from now", () => {
    expect(syncDates(null, new Date("2026-06-08T12:00:00Z"))).toEqual([
      "2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05","2026-06-06","2026-06-07","2026-06-08",
    ]);
  });
  it("uses lastSyncAt as the start", () => {
    expect(syncDates(new Date("2026-06-07T00:00:00Z"), new Date("2026-06-08T12:00:00Z"))).toEqual(["2026-06-07","2026-06-08"]);
  });
});
```

- [ ] **Step 8: Run.** `pnpm test garmin && pnpm exec tsc --noEmit` — Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add lib/connectors/garmin-auth.ts lib/connectors/garmin-api.ts lib/connectors/garmin-map.ts lib/connectors/garmin.ts lib/connectors/garmin-map.test.ts lib/connectors/garmin.test.ts
git commit -m "feat(garmin): live auth + per-day intraday fetch + mapping"
```

---

## Task 6: /sources login form + connect route

**Files:**
- Modify: `lib/db/sources.ts`
- Create: `app/api/sources/garmin/connect/route.ts`
- Create: `components/sources/GarminConnectForm.tsx`
- Modify: `app/sources/page.tsx`

- [ ] **Step 1: `upsertLiveGarminConnection` in `lib/db/sources.ts`** (mirror `upsertLiveDexcomConnection`).

Add `GarminCreds` to the type import and `LIVE_GARMIN_CONNECTION_ID` to the constants import, then:

```ts
export async function upsertLiveGarminConnection(creds: GarminCreds, db: Db = getDb()): Promise<string> {
  const [existing] = await db
    .select({ id: sourceConnection.id, metadata: sourceConnection.metadata })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, LIVE_GARMIN_CONNECTION_ID))
    .limit(1);
  if (existing) {
    const metadata = { ...(existing.metadata ?? {}), garmin: creds };
    await db.update(sourceConnection).set({ status: "active", metadata }).where(eq(sourceConnection.id, LIVE_GARMIN_CONNECTION_ID));
  } else {
    await db.insert(sourceConnection).values({
      id: LIVE_GARMIN_CONNECTION_ID, userId: SEED_USER_ID, sourceType: "garmin",
      displayName: "Garmin", status: "active", metadata: { garmin: creds },
    });
  }
  return LIVE_GARMIN_CONNECTION_ID;
}
```

- [ ] **Step 2: `app/api/sources/garmin/connect/route.ts`** (POST email/password → login → persist).

```ts
import { NextResponse } from "next/server";
import { loginGarmin } from "@/lib/connectors/garmin-auth";
import { upsertLiveGarminConnection } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let email: string, password: string;
  try {
    ({ email, password } = await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "email and password required" }, { status: 400 });
  }
  try {
    const creds = await loginGarmin(email, password);
    await upsertLiveGarminConnection(creds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "login failed";
    console.error("[garmin/connect] login failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
```

- [ ] **Step 3: `components/sources/GarminConnectForm.tsx`** (client form).

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function GarminConnectForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sources/garmin/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) { setMsg("connected"); setEmail(""); setPassword(""); router.refresh(); }
      else setMsg(`error: ${data.error}`);
    } catch {
      setMsg("request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Connect Garmin</div>
      <input type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm" />
      <input type="password" required placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm" />
      <Button type="submit" disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
      {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
    </form>
  );
}
```

- [ ] **Step 4: Render the form in `app/sources/page.tsx`** when no live Garmin connection exists yet.

Add imports and compute the flag, then render the form above `SourcesView`:

```tsx
import { GarminConnectForm } from "@/components/sources/GarminConnectForm";
import { LIVE_GARMIN_CONNECTION_ID } from "@/lib/constants";
```
```tsx
  const garminConnected = rows.some((r) => r.id === LIVE_GARMIN_CONNECTION_ID);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {!garminConnected && <GarminConnectForm />}
      <SourcesView sources={serializeSources(rows)} connect={connect} />
    </div>
  );
```

- [ ] **Step 5: Typecheck + build.** Run: `pnpm exec tsc --noEmit && pnpm build` — Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/db/sources.ts app/api/sources/garmin/connect/route.ts components/sources/GarminConnectForm.tsx app/sources/page.tsx
git commit -m "feat(garmin): /sources login form + connect route"
```

---

## Task 7: Deploy check (native dependency)

**Files:**
- Modify: `Dockerfile` (only if the prebuilt binary is missing for the image platform)

- [ ] **Step 1: Confirm `node-libcurl-ja3` resolves a prebuilt for the deploy image.** The Railway/Docker image is Linux. In the build, after `pnpm install`, run a load check: `node -e "require('garmin-connect-client')"` (the install must have run the `node-libcurl-ja3` build script — `pnpm.onlyBuiltDependencies` already whitelists it).
- [ ] **Step 2: If the prebuilt is unavailable for the image's `node-abi`/platform,** add build tooling to the builder stage (`apk add --no-cache build-base curl-dev` for Alpine, or `python3 make g++` for Debian) so node-pre-gyp can compile from source. Otherwise no change.
- [ ] **Step 3: Commit (if changed).**

```bash
git add Dockerfile
git commit -m "build(garmin): ensure node-libcurl-ja3 builds in the deploy image"
```

---

## Task 8: Remove the spike scaffold

- [ ] **Step 1:** Delete `scripts/garmin-spike.ts` and its `garmin:spike` script in `package.json` once the connector's live path is verified against a real account.
- [ ] **Step 2: Commit.**

```bash
git rm scripts/garmin-spike.ts
git add package.json
git commit -m "chore(garmin): remove live-first spike scaffold"
```

---

## Appendix A: Spike endpoint results (fill from Task 0)

| Endpoint | 200? | JSON shape (truncated) |
| --- | --- | --- |
| `userprofile-service/socialProfile` | | |
| `wellness-service/wellness/dailyHeartRate/{dn}?date=` | | |
| `wellness-service/wellness/dailyStress/{date}` | | |
| `wellness-service/wellness/bodyBattery/reports/daily` | | |
| `wellness-service/wellness/daily/spo2/{date}` | | |
| `wellness-service/wellness/daily/respiration/{date}` | | |
| `metrics-service/metrics/maxmet/daily/{d}/{d}` | | |
| `hrv-service/hrv/{date}` | | |
| `metrics-service/metrics/trainingreadiness/{date}` | | |
| `usersummary-service/usersummary/daily/{dn}?calendarDate=` | | |
| `activitylist-service/activities/search/activities` | | |

Use these to (a) correct the URLs/field names in `garmin-api.ts` + `garmin-map.ts`, and (b) add `map*` functions + `fetchDay` calls for SpO2, respiration, steps, VO2max, training readiness, daily summary, activities, and sleep.

---

## Self-review notes

- **Spec coverage:** mock fallback (T4) · per-sample observations (T1/T3) · activity+sleep timeline events (T3) · metric union (T2) · saveCredentials generalization (T2) · device-identity auth via lib (T5) · session in `metadata.garmin` (T5/T6) · per-day window + 5s rate-limit (T5) · form auth UI (T6) · idempotency (existing pipeline, unchanged) · native-dep deploy (T7). Cold-storage un-archive + MFA resume intentionally out of scope (noted in spec).
- **Endpoint uncertainty** is isolated to T5's `garmin-api`/`garmin-map`, explicitly reconciled against T0's Appendix A. The pure mappers are unit-tested against representative JSON so they're correct-by-construction once field names match.
