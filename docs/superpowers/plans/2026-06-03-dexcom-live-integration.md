# Dexcom Live Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real 3-legged Dexcom OAuth2 connect flow and live EGV (glucose) fetch behind the existing mock connector, normalized through the unchanged ingest pipeline, with mock fallback.

**Architecture:** The `Connector` interface gains a per-connection `ConnectorSyncContext` (connection metadata + `lastSyncAt` + a `saveCredentials` callback). The Dexcom connector branches on whether the connection holds OAuth tokens: no tokens → emit seeded mock readings (today's behavior); tokens → refresh-if-expired, fetch EGVs for the window since `lastSyncAt`, map to `DexcomReadingPayload[]`. A pure `executeSync` orchestrator wraps the connector call with error capture; OAuth `connect`/`callback` routes drive the grant and store tokens in a dedicated live connection. Idempotency (recordId dedup) and `normalizeDexcom` are reused unchanged.

**Tech Stack:** Next.js (App Router) · TypeScript · Drizzle/Postgres · Vitest · `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-03-dexcom-live-integration-design.md`

---

## File Structure

**Create:**
- `lib/connectors/dexcom-env.ts` — reads `DEXCOM_*` env, `isDexcomLive()`.
- `lib/connectors/dexcom-oauth.ts` — pure OAuth HTTP (authorize URL, code exchange, refresh, expiry calc).
- `lib/connectors/dexcom-api.ts` — EGV fetch + `egvToPayload` mapper + Dexcom date format.
- `lib/connectors/sync.ts` — pure `executeSync` orchestrator + `SyncStore` interface.
- `lib/connectors/connectable.ts` — `CONNECTABLE` registry + `dexcomConnectAvailable` gate.
- `app/api/sources/dexcom/connect/route.ts` — GET → redirect to Dexcom consent.
- `app/api/sources/dexcom/callback/route.ts` — GET → exchange code, upsert live connection.
- Test files alongside each `lib/connectors/*.ts` unit.

**Modify:**
- `lib/connectors/types.ts` — `DexcomCreds`, `ConnectorSyncContext`, `Connector.sync(ctx)`.
- `lib/connectors/cashflow.ts`, `lib/connectors/dexcom.ts` — accept `ctx`.
- `lib/db/sources.ts` — `DbSyncStore`, rewrite `runConnectorSync` via `executeSync`, `upsertLiveDexcomConnection`.
- `lib/constants.ts` — `LIVE_DEXCOM_CONNECTION_ID`.
- `app/sources/page.tsx`, `components/sources/SourcesView.tsx` — connect affordance.
- `.env.example` — `DEXCOM_API_BASE`.

---

## Task 1: Constants + env example

**Files:**
- Modify: `lib/constants.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add the live connection id constant**

In `lib/constants.ts`, append after the seed connection ids:

```ts
// Fixed id for the live (OAuth-connected) Dexcom connection, distinct from the
// mock seed connection so live data and mock demo data coexist.
export const LIVE_DEXCOM_CONNECTION_ID = "00000000-0000-4000-8000-000000000020";
```

- [ ] **Step 2: Add the API base env var**

In `.env.example`, replace the Dexcom block:

```
# Dexcom connector (mock mode in v0 — leave blank to use mock data).
DEXCOM_CLIENT_ID=
DEXCOM_CLIENT_SECRET=
DEXCOM_REDIRECT_URI=
```

with:

```
# Dexcom connector. Leave the client vars blank to stay in mock mode.
# To go live: create an app at https://developer.dexcom.com, set these, and
# connect from /sources. DEXCOM_API_BASE defaults to the sandbox host.
DEXCOM_CLIENT_ID=
DEXCOM_CLIENT_SECRET=
DEXCOM_REDIRECT_URI=
DEXCOM_API_BASE=https://sandbox-api.dexcom.com
```

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts .env.example
git commit -m "chore: add Dexcom live connection id + DEXCOM_API_BASE env"
```

---

## Task 2: Dexcom env reader

**Files:**
- Create: `lib/connectors/dexcom-env.ts`
- Test: `lib/connectors/dexcom-env.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/connectors/dexcom-env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getDexcomEnv, isDexcomLive } from "@/lib/connectors/dexcom-env";

const live = {
  DEXCOM_CLIENT_ID: "cid",
  DEXCOM_CLIENT_SECRET: "secret",
  DEXCOM_REDIRECT_URI: "http://localhost:3000/api/sources/dexcom/callback",
};

describe("getDexcomEnv", () => {
  it("reads client vars and defaults apiBase to the sandbox host", () => {
    expect(getDexcomEnv(live)).toEqual({
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/api/sources/dexcom/callback",
      apiBase: "https://sandbox-api.dexcom.com",
    });
  });

  it("honors an explicit DEXCOM_API_BASE", () => {
    expect(getDexcomEnv({ ...live, DEXCOM_API_BASE: "https://api.dexcom.com" }).apiBase).toBe(
      "https://api.dexcom.com",
    );
  });
});

describe("isDexcomLive", () => {
  it("is true only when all three client vars are present", () => {
    expect(isDexcomLive(live)).toBe(true);
  });
  it("is false when any client var is missing or blank", () => {
    expect(isDexcomLive({ ...live, DEXCOM_CLIENT_SECRET: "" })).toBe(false);
    expect(isDexcomLive({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/connectors/dexcom-env.test.ts`
Expected: FAIL — cannot find module `dexcom-env`.

- [ ] **Step 3: Write minimal implementation**

`lib/connectors/dexcom-env.ts`:

```ts
export interface DexcomEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
}

type Source = Record<string, string | undefined>;

const SANDBOX_BASE = "https://sandbox-api.dexcom.com";

/** Read Dexcom env. Pass a source object (defaults to process.env). */
export function getDexcomEnv(src: Source = process.env): DexcomEnv {
  return {
    clientId: src.DEXCOM_CLIENT_ID ?? "",
    clientSecret: src.DEXCOM_CLIENT_SECRET ?? "",
    redirectUri: src.DEXCOM_REDIRECT_URI ?? "",
    apiBase: src.DEXCOM_API_BASE || SANDBOX_BASE,
  };
}

/** True when all client credentials are configured (live mode available). */
export function isDexcomLive(src: Source = process.env): boolean {
  const e = getDexcomEnv(src);
  return Boolean(e.clientId && e.clientSecret && e.redirectUri);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/connectors/dexcom-env.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/dexcom-env.ts lib/connectors/dexcom-env.test.ts
git commit -m "feat: add Dexcom env reader + isDexcomLive"
```

---

## Task 3: Context-aware connector pipeline

Changes the `Connector` interface to thread per-connection context, updates the
two existing connectors to accept it (behavior unchanged), adds a pure
`executeSync` orchestrator with error capture, and rewrites `runConnectorSync`
to use it. The Dexcom live branch comes in Task 6 — here Dexcom still emits mock.

**Files:**
- Modify: `lib/connectors/types.ts`
- Modify: `lib/connectors/cashflow.ts`
- Modify: `lib/connectors/dexcom.ts`
- Create: `lib/connectors/sync.ts`
- Test: `lib/connectors/sync.test.ts`
- Modify: `lib/db/sources.ts`

- [ ] **Step 1: Extend the connector interface**

Replace the entire contents of `lib/connectors/types.ts`:

```ts
import type { SourceType } from "@/lib/db/schema";

/** OAuth credentials for a live source, stored in source_connection.metadata. */
export interface DexcomCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  scope: string;
  apiBase: string;
}

/** The connection a connector is syncing, as the connector needs to see it. */
export interface SyncConnection {
  id: string;
  userId: string;
  sourceType: SourceType;
  metadata: Record<string, unknown>;
  lastSyncAt: Date | null;
}

/** Context passed to a connector's sync(): the connection, the clock, and a
 *  callback to persist rotated credentials back to the connection. */
export interface ConnectorSyncContext {
  connection: SyncConnection;
  now: Date;
  saveCredentials(creds: DexcomCreds): Promise<void>;
}

/** A source connector emits raw payloads to be run through the ingest pipeline.
 *  v0 connectors fall back to mock; live connectors read tokens from ctx. */
export interface Connector {
  readonly sourceType: SourceType;
  sync(ctx: ConnectorSyncContext): Promise<unknown[]>;
}
```

- [ ] **Step 2: Update the cashflow connector to accept ctx**

Replace `lib/connectors/cashflow.ts`:

```ts
import type { Connector } from "./types";
import { cashflowDay } from "@/lib/mock/data";

/** Mock Cashflow connector — emits read-only transaction payloads. */
export const cashflowConnector: Connector = {
  sourceType: "cashflow",
  async sync() {
    return cashflowDay;
  },
};
```

(The `sync` signature now satisfies `(ctx) => ...` structurally even though it
ignores the argument — TypeScript allows a function that takes fewer parameters.)

- [ ] **Step 3: Keep the Dexcom connector mock-only but on the new interface**

Leave `lib/connectors/dexcom.ts` as-is for now — its `async sync()` already
satisfies the new interface (ignores `ctx`). No change in this task.

- [ ] **Step 4: Write the failing test for executeSync**

`lib/connectors/sync.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { executeSync, type SyncStore } from "@/lib/connectors/sync";
import type { Connector, ConnectorSyncContext, SyncConnection } from "@/lib/connectors/types";

const conn: SyncConnection = {
  id: "conn-1",
  userId: "user-1",
  sourceType: "dexcom",
  metadata: {},
  lastSyncAt: null,
};

function fakeStore(overrides: Partial<SyncStore> = {}): SyncStore {
  return {
    saveCredentials: vi.fn(async () => {}),
    ingest: vi.fn(async () => ({ found: 2, created: 2, observations: 2, timelineEvents: 0 })),
    markSynced: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("executeSync", () => {
  it("runs the connector, ingests payloads, marks synced, and returns the counts", async () => {
    const store = fakeStore();
    const connector: Connector = { sourceType: "dexcom", sync: vi.fn(async () => [{ a: 1 }, { a: 2 }]) };

    const result = await executeSync(store, connector, conn, new Date("2026-06-03T00:00:00Z"));

    expect(result).toEqual({ ok: true, found: 2, created: 2, observations: 2, timelineEvents: 0 });
    expect(store.ingest).toHaveBeenCalledWith(
      { id: "conn-1", userId: "user-1", sourceType: "dexcom" },
      [{ a: 1 }, { a: 2 }],
    );
    expect(store.markSynced).toHaveBeenCalledWith("conn-1");
    expect(store.markError).not.toHaveBeenCalled();
  });

  it("passes a saveCredentials callback bound to the connection id", async () => {
    const store = fakeStore();
    const creds = { accessToken: "a", refreshToken: "r", expiresAt: "x", scope: "s", apiBase: "b" };
    const connector: Connector = {
      sourceType: "dexcom",
      sync: async (ctx: ConnectorSyncContext) => {
        await ctx.saveCredentials(creds);
        return [];
      },
    };

    await executeSync(store, connector, conn, new Date());

    expect(store.saveCredentials).toHaveBeenCalledWith("conn-1", creds);
  });

  it("captures a thrown error: marks error and returns ok:false", async () => {
    const store = fakeStore();
    const connector: Connector = {
      sourceType: "dexcom",
      sync: async () => {
        throw new Error("boom");
      },
    };

    const result = await executeSync(store, connector, conn, new Date());

    expect(result).toEqual({ ok: false, error: "boom" });
    expect(store.markError).toHaveBeenCalledWith("conn-1", "boom");
    expect(store.markSynced).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm test lib/connectors/sync.test.ts`
Expected: FAIL — cannot find module `sync`.

- [ ] **Step 6: Implement executeSync**

`lib/connectors/sync.ts`:

```ts
import type { IngestResult } from "@/lib/domain/ingest";
import type { Connector, ConnectorSyncContext, DexcomCreds, SyncConnection } from "./types";

/** Side-effecting operations executeSync needs. DB-backed impl lives in lib/db. */
export interface SyncStore {
  saveCredentials(connectionId: string, creds: DexcomCreds): Promise<void>;
  ingest(
    conn: { id: string; userId: string; sourceType: SyncConnection["sourceType"] },
    payloads: unknown[],
  ): Promise<IngestResult>;
  markSynced(connectionId: string): Promise<void>;
  markError(connectionId: string, message: string): Promise<void>;
}

export type SyncResult =
  | { ok: false; error: string }
  | { ok: true; found: number; created: number; observations: number; timelineEvents: number };

/** Run one connection's connector and ingest its payloads. Pure orchestration:
 *  all IO goes through `store`. On any throw, the connection is marked error. */
export async function executeSync(
  store: SyncStore,
  connector: Connector,
  conn: SyncConnection,
  now: Date,
): Promise<SyncResult> {
  try {
    const ctx: ConnectorSyncContext = {
      connection: conn,
      now,
      saveCredentials: (creds) => store.saveCredentials(conn.id, creds),
    };
    const payloads = await connector.sync(ctx);
    const result = await store.ingest(
      { id: conn.id, userId: conn.userId, sourceType: conn.sourceType },
      payloads,
    );
    await store.markSynced(conn.id);
    return { ok: true, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.markError(conn.id, message);
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test lib/connectors/sync.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 8: Rewrite runConnectorSync to use executeSync + a DB store**

Replace the entire contents of `lib/db/sources.ts`:

```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sourceConnection } from "@/lib/db/schema";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import { getConnector } from "@/lib/connectors";
import { executeSync, type SyncResult, type SyncStore } from "@/lib/connectors/sync";
import type { DexcomCreds, SyncConnection } from "@/lib/connectors/types";

type Db = ReturnType<typeof getDb>;

export async function listSourceConnections(userId: string, db: Db = getDb()) {
  return db.select().from(sourceConnection).where(eq(sourceConnection.userId, userId));
}

/** DB-backed SyncStore: persists creds/status into source_connection and runs
 *  the ingest pipeline. */
class DbSyncStore implements SyncStore {
  constructor(private readonly db: Db) {}

  async saveCredentials(connectionId: string, creds: DexcomCreds): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}), dexcom: creds };
    await this.db.update(sourceConnection).set({ metadata }).where(eq(sourceConnection.id, connectionId));
  }

  async ingest(conn: { id: string; userId: string; sourceType: SyncConnection["sourceType"] }, payloads: unknown[]) {
    return ingestRawEvents(new DbIngestStore(this.db), conn, payloads);
  }

  async markSynced(connectionId: string): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}) };
    delete (metadata as Record<string, unknown>).lastError;
    await this.db
      .update(sourceConnection)
      .set({ lastSyncAt: new Date(), status: "active", metadata })
      .where(eq(sourceConnection.id, connectionId));
  }

  async markError(connectionId: string, message: string): Promise<void> {
    const [row] = await this.db
      .select({ metadata: sourceConnection.metadata })
      .from(sourceConnection)
      .where(eq(sourceConnection.id, connectionId))
      .limit(1);
    const metadata = { ...(row?.metadata ?? {}), lastError: message };
    await this.db.update(sourceConnection).set({ status: "error", metadata }).where(eq(sourceConnection.id, connectionId));
  }
}

/** Load a connection, run its connector through executeSync (idempotent ingest,
 *  credential rotation, error capture). */
export async function runConnectorSync(connectionId: string, db: Db = getDb()): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(sourceConnection)
    .where(eq(sourceConnection.id, connectionId))
    .limit(1);
  if (!conn) return { ok: false, error: "connection not found" };

  const connector = getConnector(conn.sourceType);
  if (!connector) return { ok: false, error: `no connector for source "${conn.sourceType}"` };

  const syncConn: SyncConnection = {
    id: conn.id,
    userId: conn.userId,
    sourceType: conn.sourceType,
    metadata: conn.metadata ?? {},
    lastSyncAt: conn.lastSyncAt ?? null,
  };
  return executeSync(new DbSyncStore(db), connector, syncConn, new Date());
}
```

- [ ] **Step 9: Run the full connector + domain suite to confirm nothing regressed**

Run: `pnpm test lib/connectors lib/domain`
Expected: PASS. (`SyncResult` shape is unchanged from before, so the sync route still compiles.)

- [ ] **Step 10: Commit**

```bash
git add lib/connectors/types.ts lib/connectors/cashflow.ts lib/connectors/sync.ts lib/connectors/sync.test.ts lib/db/sources.ts
git commit -m "feat: context-aware connector sync with credential + error handling"
```

---

## Task 4: Dexcom OAuth client

**Files:**
- Create: `lib/connectors/dexcom-oauth.ts`
- Test: `lib/connectors/dexcom-oauth.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/connectors/dexcom-oauth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildAuthorizeUrl, tokenExpiryFrom, exchangeCode, refresh } from "@/lib/connectors/dexcom-oauth";
import type { DexcomEnv } from "@/lib/connectors/dexcom-env";

const env: DexcomEnv = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/sources/dexcom/callback",
  apiBase: "https://sandbox-api.dexcom.com",
};

describe("buildAuthorizeUrl", () => {
  it("builds the consent URL with offline_access scope and the state", () => {
    const url = new URL(buildAuthorizeUrl(env, "state-123"));
    expect(url.origin + url.pathname).toBe("https://sandbox-api.dexcom.com/v2/oauth2/login");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(env.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("state")).toBe("state-123");
  });
});

describe("tokenExpiryFrom", () => {
  it("adds expires_in seconds to now and returns ISO", () => {
    const now = new Date("2026-06-03T00:00:00.000Z");
    expect(tokenExpiryFrom(3600, now)).toBe("2026-06-03T01:00:00.000Z");
  });
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("exchangeCode", () => {
  it("POSTs the authorization_code grant and maps the token response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 7200, scope: "offline_access" }),
    );
    const creds = await exchangeCode(env, "the-code", new Date("2026-06-03T00:00:00.000Z"), fetchImpl);

    expect(creds).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: "2026-06-03T02:00:00.000Z",
      scope: "offline_access",
      apiBase: "https://sandbox-api.dexcom.com",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sandbox-api.dexcom.com/v2/oauth2/token");
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("secret");
    expect(body.get("redirect_uri")).toBe(env.redirectUri);
  });

  it("throws on a non-ok token response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_grant" }, false));
    await expect(exchangeCode(env, "bad", new Date(), fetchImpl)).rejects.toThrow(/dexcom token exchange failed/i);
  });
});

describe("refresh", () => {
  it("POSTs the refresh_token grant and maps the rotated tokens", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline_access" }),
    );
    const creds = await refresh(env, "old-rt", new Date("2026-06-03T00:00:00.000Z"), fetchImpl);

    expect(creds.accessToken).toBe("at2");
    expect(creds.refreshToken).toBe("rt2");
    expect(creds.expiresAt).toBe("2026-06-03T01:00:00.000Z");
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/connectors/dexcom-oauth.test.ts`
Expected: FAIL — cannot find module `dexcom-oauth`.

- [ ] **Step 3: Implement the OAuth client**

`lib/connectors/dexcom-oauth.ts`:

```ts
import type { DexcomEnv } from "./dexcom-env";
import type { DexcomCreds } from "./types";

type FetchImpl = typeof fetch;

interface DexcomTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** ISO timestamp `seconds` after `now`. */
export function tokenExpiryFrom(seconds: number, now: Date): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/** The Dexcom consent URL to redirect the user to. */
export function buildAuthorizeUrl(env: DexcomEnv, state: string): string {
  const url = new URL(`${env.apiBase}/v2/oauth2/login`);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("state", state);
  return url.toString();
}

async function postToken(
  env: DexcomEnv,
  params: Record<string, string>,
  now: Date,
  fetchImpl: FetchImpl,
): Promise<DexcomCreds> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    ...params,
  });
  const res = await fetchImpl(`${env.apiBase}/v2/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`dexcom token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as DexcomTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: tokenExpiryFrom(json.expires_in, now),
    scope: json.scope,
    apiBase: env.apiBase,
  };
}

/** Exchange an authorization code for the initial credentials. */
export function exchangeCode(env: DexcomEnv, code: string, now: Date, fetchImpl: FetchImpl = fetch): Promise<DexcomCreds> {
  return postToken(env, { grant_type: "authorization_code", code }, now, fetchImpl);
}

/** Exchange a refresh token for rotated credentials. */
export function refresh(env: DexcomEnv, refreshToken: string, now: Date, fetchImpl: FetchImpl = fetch): Promise<DexcomCreds> {
  return postToken(env, { grant_type: "refresh_token", refresh_token: refreshToken }, now, fetchImpl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/connectors/dexcom-oauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/dexcom-oauth.ts lib/connectors/dexcom-oauth.test.ts
git commit -m "feat: add Dexcom OAuth client (authorize, exchange, refresh)"
```

---

## Task 5: Dexcom EGV API client

**Files:**
- Create: `lib/connectors/dexcom-api.ts`
- Test: `lib/connectors/dexcom-api.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/connectors/dexcom-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { dexcomDate, egvToPayload, fetchEgvs } from "@/lib/connectors/dexcom-api";

describe("dexcomDate", () => {
  it("formats a Date as YYYY-MM-DDThh:mm:ss in UTC, no zone, no millis", () => {
    expect(dexcomDate(new Date("2026-06-03T04:05:06.789Z"))).toBe("2026-06-03T04:05:06");
  });
});

describe("egvToPayload", () => {
  it("maps a Dexcom v3 EGV record to a DexcomReadingPayload using systemTime as UTC", () => {
    const payload = egvToPayload({
      recordId: "egv-1",
      systemTime: "2026-06-03T08:00:00",
      displayTime: "2026-06-03T01:00:00",
      value: 120,
      unit: "mg/dL",
      trend: "flat",
      trendRate: 0.3,
    });
    expect(payload).toEqual({
      value: 120,
      unit: "mg/dL",
      timestamp: "2026-06-03T08:00:00.000Z",
      trend: "flat",
      trendRate: 0.3,
      recordId: "egv-1",
    });
  });

  it("returns null for records with a null value (Low/High markers)", () => {
    expect(
      egvToPayload({ recordId: "egv-2", systemTime: "2026-06-03T08:05:00", displayTime: "x", value: null, unit: "mg/dL" }),
    ).toBeNull();
  });

  it("omits trendRate when absent", () => {
    const payload = egvToPayload({ recordId: "egv-3", systemTime: "2026-06-03T08:10:00", displayTime: "x", value: 99, unit: "mg/dL", trend: "flat" });
    expect(payload).toEqual({ value: 99, unit: "mg/dL", timestamp: "2026-06-03T08:10:00.000Z", trend: "flat", recordId: "egv-3" });
  });
});

describe("fetchEgvs", () => {
  it("GETs the v3 egvs endpoint with bearer auth and date range, returns records", async () => {
    const records = [{ recordId: "a" }];
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ records }), text: async () => "" }) as Response);

    const out = await fetchEgvs("tok", "https://sandbox-api.dexcom.com", "2026-06-01T00:00:00", "2026-06-02T00:00:00", fetchImpl);

    expect(out).toEqual(records);
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe("https://sandbox-api.dexcom.com/v3/users/self/egvs");
    expect(u.searchParams.get("startDate")).toBe("2026-06-01T00:00:00");
    expect(u.searchParams.get("endDate")).toBe("2026-06-02T00:00:00");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "unauthorized" }) as Response);
    await expect(fetchEgvs("tok", "https://x", "a", "b", fetchImpl)).rejects.toThrow(/dexcom egv fetch failed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/connectors/dexcom-api.test.ts`
Expected: FAIL — cannot find module `dexcom-api`.

- [ ] **Step 3: Implement the API client**

`lib/connectors/dexcom-api.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/connectors/dexcom-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/dexcom-api.ts lib/connectors/dexcom-api.test.ts
git commit -m "feat: add Dexcom EGV fetch + egvToPayload mapper"
```

---

## Task 6: Dexcom connector live branch

**Files:**
- Modify: `lib/connectors/dexcom.ts`
- Test: `lib/connectors/dexcom.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/connectors/dexcom.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { dexcomConnector } from "@/lib/connectors/dexcom";
import type { ConnectorSyncContext, DexcomCreds, SyncConnection } from "@/lib/connectors/types";

function ctxFor(connection: Partial<SyncConnection>, now: Date, saveCredentials = vi.fn(async () => {})): ConnectorSyncContext {
  return {
    connection: { id: "c", userId: "u", sourceType: "dexcom", metadata: {}, lastSyncAt: null, ...connection },
    now,
    saveCredentials,
  };
}

function egvResponse(records: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ records }), text: async () => "" } as Response;
}
function tokenResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
}

describe("dexcomConnector (mock branch)", () => {
  it("emits seeded readings when the connection has no credentials", async () => {
    const out = await dexcomConnector.sync(ctxFor({ metadata: {} }, new Date("2026-06-03T00:00:00Z")));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty("value");
    expect(out[0]).toHaveProperty("unit");
  });
});

describe("dexcomConnector (live branch)", () => {
  const future = "2026-06-03T12:00:00.000Z";
  const creds: DexcomCreds = {
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: future,
    scope: "offline_access",
    apiBase: "https://sandbox-api.dexcom.com",
  };

  it("fetches EGVs with the stored token and maps them to payloads", async () => {
    const fetchImpl = vi.fn(async () =>
      egvResponse([
        { recordId: "e1", systemTime: "2026-06-03T08:00:00", displayTime: "x", value: 110, unit: "mg/dL", trend: "flat" },
        { recordId: "e2", systemTime: "2026-06-03T08:05:00", displayTime: "x", value: null, unit: "mg/dL" },
      ]),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const out = await dexcomConnector.sync(ctxFor({ metadata: { dexcom: creds } }, new Date("2026-06-03T09:00:00Z")));

    expect(out).toEqual([
      { value: 110, unit: "mg/dL", timestamp: "2026-06-03T08:00:00.000Z", trend: "flat", recordId: "e1" },
    ]);
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/v3/users/self/egvs");
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe("Bearer at");
    vi.unstubAllGlobals();
  });

  it("refreshes and persists rotated creds when the access token is expired", async () => {
    const expired = { ...creds, expiresAt: "2026-06-03T00:00:00.000Z" };
    const save = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600, scope: "offline_access" }))
      .mockResolvedValueOnce(egvResponse([{ recordId: "e1", systemTime: "2026-06-03T08:00:00", displayTime: "x", value: 90, unit: "mg/dL" }]));
    vi.stubGlobal("fetch", fetchImpl);

    const out = await dexcomConnector.sync(ctxFor({ metadata: { dexcom: expired } }, new Date("2026-06-03T09:00:00Z"), save));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "at2", refreshToken: "rt2" }));
    expect((fetchImpl.mock.calls[1][1]!.headers as Record<string, string>).Authorization).toBe("Bearer at2");
    expect(out).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/connectors/dexcom.test.ts`
Expected: FAIL — live-branch assertions fail (current connector ignores ctx and always returns mock; with stubbed fetch the live test gets seeded mock data, not the mapped EGVs).

- [ ] **Step 3: Implement the live branch**

Replace `lib/connectors/dexcom.ts`:

```ts
import type { Connector, ConnectorSyncContext, DexcomCreds } from "./types";
import type { DexcomReadingPayload } from "@/lib/domain/types";
import { glucoseNormalDay, glucoseVolatileDay } from "@/lib/mock/data";
import { getDexcomEnv } from "./dexcom-env";
import { refresh } from "./dexcom-oauth";
import { dexcomDate, egvToPayload, fetchEgvs } from "./dexcom-api";

const DAY_MS = 24 * 60 * 60 * 1000;

function readCreds(metadata: Record<string, unknown>): DexcomCreds | null {
  const c = metadata.dexcom as DexcomCreds | undefined;
  return c?.refreshToken ? c : null;
}

/** Dexcom connector. Mock (seeded) when the connection has no credentials;
 *  live EGV fetch when it does. Rotated refresh tokens are persisted via ctx. */
export const dexcomConnector: Connector = {
  sourceType: "dexcom",
  async sync(ctx: ConnectorSyncContext): Promise<unknown[]> {
    const stored = readCreds(ctx.connection.metadata);
    if (!stored) {
      return [...glucoseNormalDay, ...glucoseVolatileDay];
    }

    let creds = stored;
    if (new Date(creds.expiresAt).getTime() <= ctx.now.getTime()) {
      const env = getDexcomEnv();
      creds = await refresh({ ...env, apiBase: creds.apiBase }, creds.refreshToken, ctx.now);
      await ctx.saveCredentials(creds);
    }

    const start = ctx.connection.lastSyncAt ?? new Date(ctx.now.getTime() - DAY_MS);
    const records = await fetchEgvs(creds.accessToken, creds.apiBase, dexcomDate(start), dexcomDate(ctx.now));
    return records
      .map(egvToPayload)
      .filter((p): p is DexcomReadingPayload => p !== null);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/connectors/dexcom.test.ts`
Expected: PASS (mock + live + refresh cases).

- [ ] **Step 5: Run the whole connector suite**

Run: `pnpm test lib/connectors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/connectors/dexcom.ts lib/connectors/dexcom.test.ts
git commit -m "feat: live Dexcom EGV fetch with mock fallback + token refresh"
```

---

## Task 7: OAuth connect + callback routes

**Files:**
- Create: `app/api/sources/dexcom/connect/route.ts`
- Create: `app/api/sources/dexcom/callback/route.ts`
- Modify: `lib/db/sources.ts` (add `upsertLiveDexcomConnection`)
- Test: `app/api/sources/dexcom/connect/route.test.ts`

- [ ] **Step 1: Add the live-connection upsert to lib/db/sources.ts**

Append to `lib/db/sources.ts` (and extend the imports as shown):

```ts
// add to the existing imports at the top of the file:
import { SEED_USER_ID, LIVE_DEXCOM_CONNECTION_ID } from "@/lib/constants";

/** Create or update the dedicated live Dexcom connection with fresh creds. */
export async function upsertLiveDexcomConnection(creds: DexcomCreds, db: Db = getDb()): Promise<string> {
  const [existing] = await db
    .select({ id: sourceConnection.id, metadata: sourceConnection.metadata })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, LIVE_DEXCOM_CONNECTION_ID))
    .limit(1);

  if (existing) {
    const metadata = { ...(existing.metadata ?? {}), dexcom: creds };
    await db
      .update(sourceConnection)
      .set({ status: "active", metadata })
      .where(eq(sourceConnection.id, LIVE_DEXCOM_CONNECTION_ID));
  } else {
    await db.insert(sourceConnection).values({
      id: LIVE_DEXCOM_CONNECTION_ID,
      userId: SEED_USER_ID,
      sourceType: "dexcom",
      displayName: "Dexcom",
      status: "active",
      metadata: { dexcom: creds },
    });
  }
  return LIVE_DEXCOM_CONNECTION_ID;
}
```

- [ ] **Step 2: Write the failing test for the connect route**

`app/api/sources/dexcom/connect/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/sources/dexcom/connect/route";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.DEXCOM_CLIENT_ID = "cid";
  process.env.DEXCOM_CLIENT_SECRET = "secret";
  process.env.DEXCOM_REDIRECT_URI = "http://localhost:3000/api/sources/dexcom/callback";
  process.env.DEXCOM_API_BASE = "https://sandbox-api.dexcom.com";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("GET /api/sources/dexcom/connect", () => {
  it("redirects to the Dexcom consent URL and sets a state cookie", async () => {
    const res = await GET(new Request("http://localhost:3000/api/sources/dexcom/connect"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://sandbox-api.dexcom.com/v2/oauth2/login");
    const state = loc.searchParams.get("state");
    expect(state).toBeTruthy();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dexcom_oauth_state=");
    expect(setCookie).toContain(state!);
  });

  it("redirects back to /sources with an error when not configured", async () => {
    process.env.DEXCOM_CLIENT_ID = "";
    const res = await GET(new Request("http://localhost:3000/api/sources/dexcom/connect"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/sources");
    expect(loc.searchParams.get("dexcom_error")).toBe("not_configured");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test app/api/sources/dexcom/connect/route.test.ts`
Expected: FAIL — cannot find module `route`.

- [ ] **Step 4: Implement the connect route**

`app/api/sources/dexcom/connect/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDexcomEnv, isDexcomLive } from "@/lib/connectors/dexcom-env";
import { buildAuthorizeUrl } from "@/lib/connectors/dexcom-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDexcomLive()) {
    return NextResponse.redirect(new URL("/sources?dexcom_error=not_configured", request.url));
  }
  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthorizeUrl(getDexcomEnv(), state));
  res.cookies.set("dexcom_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test app/api/sources/dexcom/connect/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the callback route**

`app/api/sources/dexcom/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDexcomEnv } from "@/lib/connectors/dexcom-env";
import { exchangeCode } from "@/lib/connectors/dexcom-oauth";
import { upsertLiveDexcomConnection } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

function back(request: Request, error?: string): NextResponse {
  const path = error ? `/sources?dexcom_error=${error}` : "/sources?dexcom=connected";
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/dexcom_oauth_state=([^;]+)/)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return back(request, "bad_state");
  }

  try {
    const creds = await exchangeCode(getDexcomEnv(), code, new Date());
    await upsertLiveDexcomConnection(creds);
  } catch {
    return back(request, "exchange_failed");
  }

  const res = back(request);
  res.cookies.delete("dexcom_oauth_state");
  return res;
}
```

- [ ] **Step 7: Run the route + connectors suite to confirm compilation**

Run: `pnpm test app/api/sources lib/connectors`
Expected: PASS. (The callback route's DB upsert is exercised manually / in integration, not unit-tested here — it requires a live DB. Its building blocks — `exchangeCode`, `upsertLiveDexcomConnection`, state check — are individually covered.)

- [ ] **Step 8: Commit**

```bash
git add app/api/sources/dexcom lib/db/sources.ts
git commit -m "feat: Dexcom OAuth connect + callback routes"
```

---

## Task 8: Sources page connect affordance

**Files:**
- Create: `lib/connectors/connectable.ts`
- Test: `lib/connectors/connectable.test.ts`
- Modify: `app/sources/page.tsx`
- Modify: `components/sources/SourcesView.tsx`

- [ ] **Step 1: Write the failing test**

`lib/connectors/connectable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CONNECTABLE, dexcomConnectAvailable } from "@/lib/connectors/connectable";
import { LIVE_DEXCOM_CONNECTION_ID } from "@/lib/constants";

describe("CONNECTABLE", () => {
  it("maps dexcom to its connect start url", () => {
    expect(CONNECTABLE.dexcom.authStartUrl).toBe("/api/sources/dexcom/connect");
  });
});

describe("dexcomConnectAvailable", () => {
  it("is true when live and no live connection exists yet", () => {
    expect(dexcomConnectAvailable(true, [{ id: "other" }])).toBe(true);
  });
  it("is false when not live", () => {
    expect(dexcomConnectAvailable(false, [])).toBe(false);
  });
  it("is false when the live connection already exists", () => {
    expect(dexcomConnectAvailable(true, [{ id: LIVE_DEXCOM_CONNECTION_ID }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/connectors/connectable.test.ts`
Expected: FAIL — cannot find module `connectable`.

- [ ] **Step 3: Implement the registry + gate**

`lib/connectors/connectable.ts`:

```ts
import { LIVE_DEXCOM_CONNECTION_ID } from "@/lib/constants";

/** Source types that support an OAuth connect flow, and where it starts. */
export const CONNECTABLE = {
  dexcom: { authStartUrl: "/api/sources/dexcom/connect", label: "Connect Dexcom" },
} as const;

/** Show the Dexcom connect button when live creds exist and no live connection has been made. */
export function dexcomConnectAvailable(isLive: boolean, sources: { id: string }[]): boolean {
  if (!isLive) return false;
  return !sources.some((s) => s.id === LIVE_DEXCOM_CONNECTION_ID);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/connectors/connectable.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the connect option from the page**

Replace `app/sources/page.tsx`:

```tsx
import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { isDexcomLive } from "@/lib/connectors/dexcom-env";
import { CONNECTABLE, dexcomConnectAvailable } from "@/lib/connectors/connectable";
import { SourcesView } from "@/components/sources/SourcesView";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const rows = await listSourceConnections(SEED_USER_ID);
  const connect = dexcomConnectAvailable(isDexcomLive(), rows)
    ? [{ label: CONNECTABLE.dexcom.label, url: CONNECTABLE.dexcom.authStartUrl }]
    : [];
  return <SourcesView sources={serializeSources(rows)} connect={connect} />;
}
```

- [ ] **Step 6: Render the connect buttons in SourcesView**

In `components/sources/SourcesView.tsx`, change the component signature and add a
connect section. Replace the function signature line:

```tsx
export function SourcesView({ sources }: { sources: SourceDTO[] }) {
```

with:

```tsx
export function SourcesView({
  sources,
  connect = [],
}: {
  sources: SourceDTO[];
  connect?: { label: string; url: string }[];
}) {
```

Then, immediately after the `<h1>…</h1>` line, insert:

```tsx
      {connect.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {connect.map((c) => (
            <a
              key={c.url}
              href={c.url}
              className="inline-flex items-center rounded-md border border-border bg-foreground px-3 py-1.5 text-sm font-medium text-background"
            >
              {c.label}
            </a>
          ))}
        </div>
      )}
```

- [ ] **Step 7: Run the connectors suite + lint to confirm nothing broke**

Run: `pnpm test lib/connectors && pnpm lint`
Expected: PASS / no lint errors in changed files.

- [ ] **Step 8: Commit**

```bash
git add lib/connectors/connectable.ts lib/connectors/connectable.test.ts app/sources/page.tsx components/sources/SourcesView.tsx
git commit -m "feat: Connect Dexcom affordance on /sources"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS — all suites, including the pre-existing domain/api tests.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Type-check via build (no DB needed at build for force-dynamic pages)**

Run: `pnpm build`
Expected: build succeeds. If it fails only on missing `DATABASE_URL` at runtime (not type errors), that is acceptable — note it; type errors are not.

- [ ] **Step 4: Manual sanity (mock path, optional, needs DB)**

With `DEXCOM_*` unset and a DB available: `pnpm db:push && pnpm db:seed`, start `pnpm dev`, open `/sources`, click **Sync** on "Dexcom (mock)" — confirm `+N new`, and `/timeline?date=2026-06-01` shows glucose. The "Connect Dexcom" button is absent (not live). This confirms zero regression in mock mode.

- [ ] **Step 5: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test: verify Dexcom integration suite green"
```

---

## Self-review notes (addressed)

- **Spec coverage:** interface change (T3), token storage (T3 DbSyncStore + T7 upsert), env reader (T2), OAuth client (T4), EGV API (T5), live connector branch (T6), connect/callback routes (T7), sources affordance (T8), error handling → `metadata.lastError` (T3 markError), env var (T1), idempotency reused (unchanged), no-live-calls-in-CI (all HTTP injected/stubbed). All present.
- **Separate live connection:** `LIVE_DEXCOM_CONNECTION_ID` (T1) distinct from `SEED_DEXCOM_CONNECTION_ID`; mock seed untouched.
- **Type consistency:** `DexcomCreds`/`SyncConnection`/`ConnectorSyncContext` defined once in `types.ts` (T3) and imported everywhere; `getDexcomEnv`/`isDexcomLive` (T2) consumed by oauth/connector/route/page; `egvToPayload`/`fetchEgvs`/`dexcomDate` (T5) consumed by the connector (T6).
- **Known untested-by-unit:** `DbSyncStore` and the callback route's DB upsert require a live Postgres; their pure building blocks are covered and they are exercised in the manual step. This is the deliberate "no live DB in CI" boundary.
