# Dexcom live integration — design

Date: 2026-06-03
Status: approved (design)
Session: `blackbox-glucose-connector`

## Why Dexcom (not Glooko)

Dexcom has an official developer portal, a sandbox API (`sandbox-api.dexcom.com`,
canned users, no physical device), and a documented OAuth2 authorization-code
flow. Glooko's API is B2B partner-only — no self-serve credentials for an
individual — wrong fit for a personal recorder. The repo already commits to
`sourceType: "dexcom"` throughout: `.env.example` has the Dexcom client vars,
`normalizeDexcom` exists, and a mock connector + seed already work.

## What already exists (do not rebuild)

- `Connector` interface, registry (`getConnector`), and the idempotent
  `runConnectorSync` → `ingestRawEvents` → dedup → `normalize` pipeline.
- `dexcomConnector` ([lib/connectors/dexcom.ts](../../../lib/connectors/dexcom.ts)) — **mock-only**, emits seeded glucose.
- `normalizeDexcom` ([lib/domain/normalize.ts](../../../lib/domain/normalize.ts)) — maps
  `DexcomReadingPayload {value, unit, timestamp, trend?, trendRate?, recordId?}`
  → a `glucose` Observation. **No change needed.**
- Idempotency: `recordId → sourceRecordId` → `raw_event` partial unique index
  dedupes overlapping fetch windows. **No change needed.**
- `.env.example` has `DEXCOM_CLIENT_ID / DEXCOM_CLIENT_SECRET / DEXCOM_REDIRECT_URI`.

So this work is the **live API client + 3-legged OAuth** behind the existing
mock, not a from-scratch connector.

## Decisions (approved)

1. **Auth:** full 3-legged OAuth2 authorization-code flow (not env refresh-token).
2. **Connector interface changes** to thread per-connection context into `sync`.
3. **Live readings land in a separate connection** from the mock seed; both coexist.

## Architecture

### 1. Connector interface change (spine-level)

`Connector.sync` becomes context-aware so a connector can read its connection's
stored tokens and persist rotated ones:

```ts
export interface DexcomCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  scope: string;
  apiBase: string;
}

export interface ConnectorSyncContext {
  connection: {
    id: string;
    userId: string;
    sourceType: SourceType;
    metadata: Record<string, unknown>;
    lastSyncAt: Date | null;
  };
  now: Date;
  /** Persist rotated credentials back to source_connection.metadata. */
  saveCredentials(creds: DexcomCreds): Promise<void>;
}

export interface Connector {
  readonly sourceType: SourceType;
  sync(ctx: ConnectorSyncContext): Promise<unknown[]>;
}
```

Blast radius:
- [lib/connectors/types.ts](../../../lib/connectors/types.ts) — interface + new types.
- [lib/connectors/cashflow.ts](../../../lib/connectors/cashflow.ts) — signature accepts `ctx`, ignores it. Behavior unchanged.
- [lib/connectors/dexcom.ts](../../../lib/connectors/dexcom.ts) — rewritten (below).
- [lib/db/sources.ts](../../../lib/db/sources.ts) — `runConnectorSync` builds `ctx` and supplies `saveCredentials`.
- Connector/sync tests calling `connector.sync()` directly get an injected `ctx`.

### 2. Token storage

Stored in `source_connection.metadata.dexcom` as `DexcomCreds`. App secret
(`DEXCOM_CLIENT_ID/SECRET`) stays in env; the **user grant** (access/refresh
tokens) is per-connection data and lives in the DB. The CLAUDE.md "secrets in
env" rule governs app secrets, not user OAuth grants — this is the standard split.

### 3. New modules

- `lib/connectors/dexcom-env.ts` — reads `DEXCOM_CLIENT_ID`, `DEXCOM_CLIENT_SECRET`,
  `DEXCOM_REDIRECT_URI`, and new `DEXCOM_API_BASE` (default
  `https://sandbox-api.dexcom.com`). Exports `getDexcomEnv()` and
  `isDexcomLive()` (= all three client vars present).
- `lib/connectors/dexcom-oauth.ts` — pure HTTP, no DB:
  - `buildAuthorizeUrl(state)` → `${base}/v2/oauth2/login?client_id=…&redirect_uri=…&response_type=code&scope=offline_access&state=…`
  - `exchangeCode(code)` → POST `${base}/v2/oauth2/token` (`grant_type=authorization_code`) → `DexcomCreds`
  - `refresh(refreshToken)` → POST `${base}/v2/oauth2/token` (`grant_type=refresh_token`) → `DexcomCreds` (rotation: persist the returned refresh token).
  - `tokenExpiryFrom(expiresInSeconds, now)` — pure helper → ISO `expiresAt`.
- `lib/connectors/dexcom-api.ts`:
  - `fetchEgvs(accessToken, base, startDate, endDate)` → GET
    `${base}/v3/users/self/egvs?startDate=…&endDate=…` (dates as
    `YYYY-MM-DDThh:mm:ss`, no zone, per Dexcom). Returns the raw records array.
  - `egvToPayload(record)` — pure: `{ value, unit, timestamp: displayTime→ISO, trend, trendRate, recordId }`.
    Records with a null `value` (Low/High status markers) are skipped in v0.

### 4. `dexcomConnector.sync(ctx)`

Per-connection branch on `ctx.connection.metadata.dexcom?.refreshToken`:
- **absent →** mock path (current behavior: emit seeded readings). Keeps the
  seeded "Dexcom (mock)" connection and fresh-clone demo working.
- **present →** live path:
  1. If `expiresAt <= now`, `refresh()` and `await ctx.saveCredentials(rotated)`.
  2. Compute window `[ctx.connection.lastSyncAt ?? now-24h, now]`.
  3. `fetchEgvs` → `egvToPayload` over records → return `DexcomReadingPayload[]`.

The returned payloads flow through the unchanged ingest pipeline; `recordId`
dedup makes re-syncs idempotent.

### 5. OAuth routes (App Router)

- `GET /api/sources/dexcom/connect` — generate `state`, set it as an HttpOnly
  cookie (CSRF), 302 → `buildAuthorizeUrl(state)`.
- `GET /api/sources/dexcom/callback?code&state` — verify `state` against cookie;
  `exchangeCode(code)`; upsert a **dedicated live** dexcom connection
  (`displayName: "Dexcom"`, fixed id distinct from the mock seed id) with the
  creds in `metadata.dexcom`; 302 → `/sources`. On bad/missing state or token
  exchange failure: 302 → `/sources?dexcom_error=…`.

### 6. Sources page

A small `CONNECTABLE` registry (`{ dexcom: { authStartUrl: "/api/sources/dexcom/connect" } }`)
drives a generic "Connect" affordance — not a hard-coded Dexcom branch. Shown
when `isDexcomLive()` is true and no token-bearing dexcom connection exists.
Connect lives on `/sources` (where connections belong). `/timeline` and
`/today` are untouched — no source special-casing in data-display surfaces.

### 7. Error handling

`runConnectorSync` wraps `connector.sync(ctx)` in try/catch. On throw: set
`status: "error"` and store the message in `metadata.lastError` (the
`source_connection` table has no dedicated error column — only `status` and
`metadata`), instead of the current unconditional `status: "active"`. A 401
after a refresh attempt surfaces as connection `status: "error"`.

### 8. Env

Add to `.env.example`:
```
# Dexcom API host (sandbox by default; set to https://api.dexcom.com for production).
DEXCOM_API_BASE=https://sandbox-api.dexcom.com
```

## Data flow

```
/sources "Connect Dexcom"
  → GET /api/sources/dexcom/connect (state cookie) → Dexcom consent
  → GET /api/sources/dexcom/callback → exchangeCode → upsert live connection (tokens in metadata)
POST /api/sources/:id/sync
  → runConnectorSync builds ctx → dexcomConnector.sync(ctx)
      → refresh if expired (saveCredentials) → fetchEgvs(window) → egvToPayload[]
  → ingestRawEvents → upsert raw_event (recordId dedup) → normalizeDexcom → upsert glucose observations
  → stamp lastSyncAt (or status:error on throw)
```

## Testing (TDD)

- Pure: `egvToPayload` (incl. null-value skip), `tokenExpiryFrom`, sync-window calc.
- `dexcom-oauth` with mocked `fetch`: authorize URL shape, code exchange, refresh + rotation.
- `dexcomConnector.sync(ctx)`: mock branch (no tokens) vs live branch (tokens +
  injected fetch); expired-token triggers refresh + `saveCredentials`.
- Callback route: happy path upserts connection; bad/missing state rejected.
- `runConnectorSync`: connector throw → `status:"error"` + message.
- **No live Dexcom HTTP in CI.** Sandbox is exercised manually.

## Out of scope (YAGNI)

- Multi-account / multiple live Dexcom connections.
- Background re-sync cron for Dexcom (manual sync button suffices for v0).
- Dexcom Share realtime backchannel.
- mg/dL ↔ mmol/L conversion — store `unit` as returned.

## Acceptance criteria

- With no Dexcom env vars: app behaves exactly as today (mock connector, seed,
  fresh-clone demo all work).
- With env vars set: `/sources` shows "Connect Dexcom"; the OAuth round-trip
  creates a live connection with tokens in `metadata`.
- Syncing the live connection fetches EGVs for the window, normalizes to glucose
  observations, and is idempotent across repeated syncs.
- Expired access tokens auto-refresh and rotate the stored refresh token.
- Connector/HTTP failure marks the connection `status:"error"` with a message in `metadata.lastError`.
- `pnpm test` passes; no live Dexcom calls in CI.
