# Garmin connector — design (2026-06-05)

## Goal

Add a `garmin` source connector to Blackbox that ingests Garmin Connect health +
activity data (full intraday) through the existing spine
(`RawEvent → {Observation, TimelineEvent}`), with a mandatory mock-mode fallback
and a best-effort live path. Source-agnostic: no Garmin special-casing in the UI
beyond its login form.

## Approach decisions

- **Transport library: `garmin-connect-client@2.0.0` (orpjones).** TypeScript,
  resumable MFA, session persistence, and — decisively — it uses Garmin's modern
  **device-identity (diauth) OAuth2** flow, not garth's OAuth1+OAuth2. It was
  published 2026-04 (after the ~2026-03 auth change that broke garth-based libs)
  and spoofs the mobile app's TLS/JA3 fingerprint (`node-libcurl-ja3`, prebuilt
  binary, no source compile locally).
- **Auth model.** Login = SSO (JA3 curl) → CAS service ticket → `diauth.garmin.com`
  device-identity grant → `OAuth2Token` + `diClientId`. Refresh =
  `grant_type=refresh_token` + `diClientId` (no OAuth1). The lib's `HttpClient`
  auto-refreshes on 401. Persist the bundle once, reuse it, **only re-login on
  expiry** (~1yr) — re-logins are what trigger Garmin 429s.
- **Granularity: per-sample payloads.** `observation` is unique on
  `(rawEventId, metric)`, so each intraday sample must be its own `raw_event` →
  one `observation` (exactly how Dexcom emits each EGV, and how garmin-grafana
  writes each point). Full intraday = thousands of raw_events/day; idempotent via
  `sourceRecordId = "<metric>:<epochMs>"`.
- **Mock-always, live best-effort.** Spec mandates mock data; live auth is
  fragile/unofficial. The connector falls back to mock fixtures when the
  connection has no creds, so the feature works on a fresh clone with no account.
- **Reference, not runtime: garmin-grafana.** We port its *patterns* (token-first
  login, per-day backward crawl, 5s rate-limit between days, raw `connectapi`
  replay, `epoch/request` cold-storage un-archive, idempotent upsert) onto our TS
  transport. Its `connectapi(url)` ≙ our `HttpClient.get(url)`.

## Architecture / files

Mirrors the dexcom split. Connector emits per-sample payloads; the existing
ingest pipeline (`ingestRawEvents`) does raw→normalized.

| File | Change |
| --- | --- |
| `lib/db/schema.ts` | Extend `observationMetrics` union: `+ spo2, respiration, vo2max, floors, intensity_minutes, calories, resting_heart_rate, training_readiness`. Flexible text column → **no migration**. |
| `lib/domain/types.ts` | `GarminObservationPayload` (metric, value, unit, timestamp, recordId, metadata?) · `GarminActivityPayload` · `GarminSleepPayload` · `GarminCreds = PersistedSession {cookies?, oauth2Token, diClientId}`. |
| `lib/connectors/garmin-auth.ts` | Wrap garmin-connect-client: `login({username,password})` → `getSession()` bundle; `fromSession(bundle)` + internal `HttpClient` for arbitrary endpoint replay. Injectable for tests. |
| `lib/connectors/garmin-api.ts` | Per-day fetch of the full metric set (lib getters where they exist + raw `HttpClient.get` replays elsewhere). 5s rate-limit between days on backfill; window = last 7 days on first sync, else incremental from `lastSyncAt`. |
| `lib/connectors/garmin-map.ts` | Garmin API JSON → flat `GarminObservationPayload[]` (one per intraday sample) + activity/sleep payloads. |
| `lib/connectors/garmin.ts` | The `Connector`: no creds in `metadata.garmin` → mock fixtures; creds → live fetch; rotate via `ctx.saveCredentials`. |
| `lib/connectors/index.ts` | Register `garmin` in the registry. |
| `lib/connectors/connectable.ts` | Generalize `CONNECTABLE` to support a `form` kind (email/password) alongside the existing `redirect` kind. |
| `lib/connectors/types.ts` | Generalize `ConnectorSyncContext.saveCredentials` (currently typed `DexcomCreds`) to a namespaced per-source bundle. Resolves the existing design debt. |
| `lib/domain/ingest.ts` | Add `case "garmin"` to `extractRawMeta` (recordId + occurredAt per payload kind). |
| `lib/domain/normalize.ts` | Add `normalizeGarmin`: observation payloads → `observation`; activity → `workout` timeline_event; sleep → `sleep` timeline_event + `sleep_duration` / stage observations. |
| `app/api/sources/garmin/connect/route.ts` | POST `{email,password}` → `login` → save session to `metadata.garmin` → connection `active`. Returns `needs_mfa` if the lib demands it (resume route stubbed; Connor's account has none). |
| `app/sources/page.tsx` | Render a Garmin card with the email/password form (driven by the generalized `CONNECTABLE`). |
| `lib/mock/data.ts` | A Garmin mock day: intraday HR/stress/body-battery/SpO2 series + one workout + one sleep, so the connector is useful with no account. |
| `*.test.ts` | Unit tests (DB-free): `garmin-map`, `normalizeGarmin`, connector mock-fallback. Mirror existing connector tests. |
| `scripts/garmin-spike.ts` | Already written — the live-first gate. Delete after the connector lands. |

## Data model mapping

- **Observations** (one per sample, scalar `value` + `unit`, `observedAt`):
  `heart_rate`, `resting_heart_rate`, `hrv`, `stress`, `body_battery`, `spo2`,
  `respiration`, `steps`, `floors`, `intensity_minutes`, `calories`, `vo2max`,
  `training_readiness`, `sleep_duration` (+ per-stage durations in metadata).
- **TimelineEvents:** activities → `workout` (`startedAt`/`endedAt`, type +
  distance + duration + calories in metadata); sleep period → `sleep` span.
- **Attribution (required):** every record carries `sourceType:"garmin"`,
  `rawEventId` back-ref; raw_event carries `sourceRecordId`. "Where did this come
  from?" stays answerable.

## Connector behavior

- **Mock fallback:** `metadata.garmin` absent/empty → return the mock day's
  payloads. Always works offline.
- **Live:** restore session via `fromSession`; the lib auto-refreshes the OAuth2
  token on 401 and re-persists the rotated bundle via `ctx.saveCredentials`
  (register `onSessionUpdate`). Fetch each day in the window; emit per-sample
  payloads.
- **Window:** first sync = last 7 days; subsequent = from `lastSyncAt` forward
  (small lookback overlap is free — recordId dedup absorbs it).
- **Rate-limit / resilience:** ≥5s between day fetches on backfill; on 429 wait +
  retry the same day; on 500 retry a bounded number then skip.
- **Cold storage:** intraday > ~6 months is archived; backfill beyond that needs a
  `wellness-service/wellness/epoch/request/{date}` POST first. Out of scope for
  v0 (note it; do not bulk-backfill > 6mo).
- **Idempotency:** raw_event dedup on `(sourceConnectionId, sourceRecordId)`;
  observations upsert on `(rawEventId, metric)`. Re-sync is free.

## Auth UI flow

1. `/sources` shows a Garmin card → email/password form (no MFA field; account
   has none).
2. POST → `…/garmin/connect` → `garmin-connect-client.login(...)` →
   `client.getSession()` → write to `metadata.garmin` → status `active`.
3. Subsequent syncs run headless off the persisted bundle.
4. MFA resume is structurally cheap (`MfaPending` is just a cookie string) and
   left as a stubbed follow-up route, not built in v0.

## Risks

- **Live auth is unofficial + was reported broken for MFA accounts ~2026-03.**
  The diauth lib is the current best bet but may break again. Mitigation: mock is
  the guaranteed spine; the spike confirms reality against the real account before
  we finalize `garmin-api`.
- **`node-libcurl-ja3` is native.** Prebuilt binary installs clean locally
  (darwin-arm64/node-v127); the Docker/Railway image must have a matching prebuilt
  (linux) or build tooling. Verify in the deploy step.
- **Intraday volume.** Thousands of raw_events/day; ingest is idempotent but bulk.
  Mock keeps local dev sane.

## Testing

- DB-free unit tests (Vitest), mirroring existing connector tests:
  `garmin-map` (API JSON → payloads), `normalizeGarmin` (payloads →
  observations/timeline events), connector mock-fallback returns the mock day.
- `garmin-auth` with an injected fake client (no network).
- Existing pipeline tests already cover idempotent ingest.

## Acceptance criteria

- Fresh clone, no creds: `garmin` connection seeds + syncs the mock day; its
  observations + workout/sleep events appear on `/timeline` and roll into the
  daily snapshot, indistinguishable in treatment from other sources.
- With creds (post-spike): `/sources` Garmin form authenticates, persists the
  session, and a sync ingests real intraday + activities for the window.
- Re-sync creates no duplicates.
- `pnpm test` / `pnpm lint` / `pnpm build` green.

## Implementation order

0. **Spike** (`pnpm garmin:spike`, needs creds) — confirm auth + which endpoints
   200; finalize the `garmin-api` endpoint list from the result.
1. Schema metric union + payload/creds types + generalize `saveCredentials`.
2. `garmin-map` + `normalizeGarmin` + `ingest` case (+ tests, mock-first).
3. Mock fixtures + `garmin.ts` connector (mock path) + registry; verify on
   `/timeline`.
4. `garmin-auth` + `garmin-api` (live path).
5. `connectable` form kind + `/sources` form + connect route.
6. Deploy check (native dep prebuilt for the cloud image).
