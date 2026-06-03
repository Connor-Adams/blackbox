# Blackbox v0 — Phase F: Sources + Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the source-connector seam (a `Connector` interface + mock Dexcom/Cashflow connectors), add Cashflow normalization (lighting up the finance card + high-spend insight), and build the `/sources` screen with per-source sync.

**Architecture:** A `Connector` emits raw payloads; `runConnectorSync` loads a source connection, dispatches to its connector, and runs the payloads through the existing `ingestRawEvents` pipeline (raw → normalize → persist, idempotent). Sync is a **direct API route** (`POST /api/sources/[id]/sync`) for v0 — synchronous and fine for mock connectors; the durable Inngest path is a post-v0 swap behind the same `runConnectorSync` seam. Cashflow normalization (deferred from Phase B/C) lands here: a transaction becomes both a `transaction_amount` observation (feeds finance snapshot + insights) and a `transaction` timeline event.

**Tech Stack:** Drizzle · Next.js App Router · Vitest. No new deps.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) §Required screens (`/sources`), §Connectors, §Cashflow/Dexcom. Builds on C (ingest, store, mock data) + D patterns.

> Run from repo root. Branch: `claude/blackbox-phase-f` (off `main`, independent of the in-flight Phase E — F touches no Phase E files, so no conflict). **Environment:** `pnpm add` blocked → edit `package.json` + `pnpm install` (none needed); no file deletions; run `pnpm test`/`build` in the subagent; **stage only the files each task lists** (`git add <files>`, never `-A`) — an unrelated formatting-only `components/timeline/AnnotationForm.tsx` change is intentionally uncommitted; leave it.

## Scope

In: Cashflow normalize (transaction → observation + timeline event) + `extractRawMeta` cashflow; `Connector` interface + `dexcomConnector`/`cashflowConnector` + registry; Cashflow mock data; sources store (`listSourceConnections`, `runConnectorSync`) + a seeded cashflow connection; `GET /api/sources` + `POST /api/sources/[id]/sync`; `/sources` screen (list + per-source sync). **Out (later, Phase G):** real OAuth/HTTP connectors (these are mock-only), Inngest-based async sync, the Cashflow read-only HTTP endpoints. `manual` has no connector (UI-driven via annotations) — sync is a no-op for it.

## File Structure (Phase F)

- `lib/domain/types.ts`, `lib/domain/normalize.ts`, `lib/domain/ingest.ts` — **modify**: cashflow payload + normalize + meta.
- `lib/domain/normalize.test.ts`, `lib/domain/ingest.test.ts` — **modify**: cashflow tests.
- `lib/connectors/types.ts`, `dexcom.ts`, `cashflow.ts`, `index.ts` — connector seam.
- `lib/mock/data.ts` + `data.test.ts` — **modify**: cashflow mock data.
- `lib/constants.ts` — **modify**: `SEED_CASHFLOW_CONNECTION_ID`.
- `lib/db/sources.ts` — `listSourceConnections`, `runConnectorSync`.
- `scripts/seed.ts` — **modify**: seed the cashflow connection + data.
- `lib/api/source-dto.ts` + `.test.ts` — `serializeSources`.
- `app/api/sources/route.ts`, `app/api/sources/[id]/sync/route.ts`.
- `app/sources/page.tsx`, `components/sources/SourcesView.tsx`.

---

## Task 1: Cashflow normalization (TDD)

**Files:** Modify `lib/domain/types.ts`, `lib/domain/normalize.ts`, `lib/domain/ingest.ts`, `lib/domain/normalize.test.ts`, `lib/domain/ingest.test.ts`.

- [ ] **Step 1: Add `CashflowTransactionPayload` to `lib/domain/types.ts`** (append after `DexcomReadingPayload`):

```ts
/** Cashflow transaction payload (read-only mirror of a Cashflow transaction). */
export interface CashflowTransactionPayload {
  recordId: string;
  amount: number; // positive = spend, in the account currency
  description: string;
  timestamp: string; // ISO 8601
  category?: string;
}
```

- [ ] **Step 2: Add failing normalize tests** — append to `lib/domain/normalize.test.ts`:

```ts
describe("normalize: cashflow", () => {
  const cbase = {
    id: "raw-3",
    userId: "user-1",
    sourceConnectionId: "conn-3",
    sourceRecordId: "tx-1",
    occurredAt: new Date("2026-06-01T12:00:00Z"),
    sourceType: "cashflow" as const,
  };

  it("maps a transaction to a transaction_amount observation AND a transaction timeline event", () => {
    const raw: RawEventInput = {
      ...cbase,
      payload: { recordId: "tx-1", amount: 62, description: "Groceries", timestamp: "2026-06-01T12:00:00Z", category: "groceries" },
    };
    const { observations, timelineEvents } = normalize(raw);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ metric: "transaction_amount", value: 62, unit: "USD", sourceType: "cashflow", rawEventId: "raw-3" });
    expect(observations[0].metadata).toMatchObject({ description: "Groceries", category: "groceries" });
    expect(timelineEvents).toHaveLength(1);
    expect(timelineEvents[0]).toMatchObject({ eventType: "transaction", title: "Groceries", sourceType: "cashflow", rawEventId: "raw-3" });
    expect(timelineEvents[0].startedAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
  });
});
```

- [ ] **Step 3: Add failing extractRawMeta test** — append to `lib/domain/ingest.test.ts`:

```ts
describe("extractRawMeta: cashflow", () => {
  it("uses the cashflow recordId + timestamp", () => {
    const meta = extractRawMeta("cashflow", { recordId: "tx-9", amount: 5, description: "x", timestamp: "2026-06-01T10:00:00Z" });
    expect(meta.sourceRecordId).toBe("tx-9");
    expect(meta.occurredAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });
});
```

- [ ] **Step 4: Run, verify the new cashflow tests FAIL.** `pnpm test lib/domain/normalize.test.ts lib/domain/ingest.test.ts` → cashflow cases fail (normalize returns empty / extractRawMeta throws for cashflow).

- [ ] **Step 5: Add the `cashflow` case to `extractRawMeta` in `lib/domain/ingest.ts`** (add the import + a case before `default`):

In the `import type { ... } from "@/lib/domain/types"` line add `CashflowTransactionPayload`. Then in the `switch (sourceType)`:
```ts
    case "cashflow": {
      const p = payload as CashflowTransactionPayload;
      return { sourceRecordId: p.recordId ?? null, occurredAt: new Date(p.timestamp) };
    }
```

- [ ] **Step 6: Add the `cashflow` normalizer to `lib/domain/normalize.ts`** (add `CashflowTransactionPayload` to the type import; add the function; add a `case "cashflow"`):

```ts
function normalizeCashflow(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as CashflowTransactionPayload;
  const extra = p.category ? { category: p.category } : {};
  return {
    observations: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "cashflow",
        metric: "transaction_amount",
        value: p.amount,
        unit: "USD",
        observedAt: new Date(p.timestamp),
        metadata: { description: p.description, ...extra },
      },
    ],
    timelineEvents: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "cashflow",
        eventType: "transaction",
        title: p.description,
        description: `$${p.amount}`,
        startedAt: new Date(p.timestamp),
        endedAt: null,
        metadata: { amount: p.amount, ...extra },
      },
    ],
  };
}
```
Add to the dispatcher switch: `case "cashflow": return normalizeCashflow(raw);`

- [ ] **Step 7: Run, verify PASS.** `pnpm test lib/domain/normalize.test.ts lib/domain/ingest.test.ts` → all pass (cashflow cases included).

- [ ] **Step 8: Commit.**
```bash
git add lib/domain/types.ts lib/domain/normalize.ts lib/domain/ingest.ts lib/domain/normalize.test.ts lib/domain/ingest.test.ts
git commit -m "feat: normalize cashflow transactions to observations + timeline events"
```

---

## Task 2: Connector interface + connectors + cashflow mock data

**Files:** Create `lib/connectors/{types,dexcom,cashflow,index}.ts`; Modify `lib/mock/data.ts`, `lib/mock/data.test.ts`.

- [ ] **Step 1: Add failing cashflow mock-data test** — append to `lib/mock/data.test.ts`:

```ts
import { cashflowDay } from "@/lib/mock/data";

describe("cashflow mock", () => {
  it("is a set of transactions whose total exceeds the high-spend threshold (200)", () => {
    expect(cashflowDay.length).toBeGreaterThan(0);
    expect(cashflowDay.every((t) => typeof t.amount === "number" && t.recordId && t.description)).toBe(true);
    const total = cashflowDay.reduce((a, b) => a + b.amount, 0);
    expect(total).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/mock/data.test.ts` → `cashflowDay` undefined.

- [ ] **Step 3: Add `cashflowDay` to `lib/mock/data.ts`** (add the type import + the export):

In the import line add `CashflowTransactionPayload`. Then append:
```ts
/** A spend day whose total ($246.50) trips the high-spend insight. */
export const cashflowDay: CashflowTransactionPayload[] = [
  { recordId: "tx-1", amount: 4.5, description: "Morning coffee", timestamp: `${D}T08:00:00Z`, category: "dining" },
  { recordId: "tx-2", amount: 62, description: "Groceries", timestamp: `${D}T12:15:00Z`, category: "groceries" },
  { recordId: "tx-3", amount: 180, description: "Dinner out", timestamp: `${D}T20:30:00Z`, category: "dining" },
];
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/mock/data.test.ts` → passes.

- [ ] **Step 5: Create `lib/connectors/types.ts`:**
```ts
import type { SourceType } from "@/lib/db/schema";

/** A source connector emits raw payloads to be run through the ingest pipeline.
 *  v0 connectors are mock; real OAuth/HTTP connectors implement the same shape. */
export interface Connector {
  readonly sourceType: SourceType;
  sync(): Promise<unknown[]>;
}
```

- [ ] **Step 6: Create `lib/connectors/dexcom.ts`:**
```ts
import type { Connector } from "./types";
import { glucoseNormalDay, glucoseVolatileDay } from "@/lib/mock/data";

/** Mock Dexcom connector — emits the seeded glucose readings. */
export const dexcomConnector: Connector = {
  sourceType: "dexcom",
  async sync() {
    return [...glucoseNormalDay, ...glucoseVolatileDay];
  },
};
```

- [ ] **Step 7: Create `lib/connectors/cashflow.ts`:**
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

- [ ] **Step 8: Create `lib/connectors/index.ts`:**
```ts
import type { Connector } from "./types";
import { dexcomConnector } from "./dexcom";
import { cashflowConnector } from "./cashflow";

const REGISTRY: Partial<Record<string, Connector>> = {
  dexcom: dexcomConnector,
  cashflow: cashflowConnector,
};

/** The connector for a source type, or null (e.g. `manual` is UI-driven). */
export function getConnector(sourceType: string): Connector | null {
  return REGISTRY[sourceType] ?? null;
}
```

- [ ] **Step 9: Type-check.** `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 10: Commit.**
```bash
git add lib/connectors lib/mock/data.ts lib/mock/data.test.ts
git commit -m "feat: add connector interface, mock dexcom/cashflow connectors, cashflow mock data"
```

---

## Task 3: Sources store + sync orchestration + seed

**Files:** Modify `lib/constants.ts`, `scripts/seed.ts`; Create `lib/db/sources.ts`.

- [ ] **Step 1: Add `SEED_CASHFLOW_CONNECTION_ID` to `lib/constants.ts`** (append):
```ts
export const SEED_CASHFLOW_CONNECTION_ID = "00000000-0000-4000-8000-000000000012";
```

- [ ] **Step 2: Create `lib/db/sources.ts`:**
```ts
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sourceConnection } from "@/lib/db/schema";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import { getConnector } from "@/lib/connectors";

type Db = ReturnType<typeof getDb>;

export async function listSourceConnections(userId: string, db: Db = getDb()) {
  return db.select().from(sourceConnection).where(eq(sourceConnection.userId, userId));
}

export type SyncResult =
  | { ok: false; error: string }
  | { ok: true; found: number; created: number; observations: number; timelineEvents: number };

/** Load a connection, run its connector, ingest the payloads, stamp lastSyncAt.
 *  Idempotent (ingest dedupes). Returns counts or an error. */
export async function runConnectorSync(connectionId: string, db: Db = getDb()): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(sourceConnection)
    .where(eq(sourceConnection.id, connectionId))
    .limit(1);
  if (!conn) return { ok: false, error: "connection not found" };

  const connector = getConnector(conn.sourceType);
  if (!connector) return { ok: false, error: `no connector for source "${conn.sourceType}"` };

  const payloads = await connector.sync();
  const result = await ingestRawEvents(
    new DbIngestStore(db),
    { id: conn.id, userId: conn.userId, sourceType: conn.sourceType },
    payloads,
  );
  await db.update(sourceConnection).set({ lastSyncAt: new Date(), status: "active" }).where(eq(sourceConnection.id, conn.id));
  return { ok: true, ...result };
}
```

- [ ] **Step 3: Update `scripts/seed.ts`** to also seed the cashflow connection + data. Replace its body with (keeps the existing dexcom + manual seeding, adds cashflow):
```ts
import { getDb } from "@/lib/db/client";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import {
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
  SEED_CASHFLOW_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay, cashflowDay } from "@/lib/mock/data";

async function main() {
  void getDb();
  const store = new DbIngestStore();

  const dexcom = await ensureSourceConnection({ id: SEED_DEXCOM_CONNECTION_ID, sourceType: "dexcom", displayName: "Dexcom (mock)" });
  const manual = await ensureSourceConnection({ id: SEED_MANUAL_CONNECTION_ID, sourceType: "manual", displayName: "Manual log" });
  const cashflow = await ensureSourceConnection({ id: SEED_CASHFLOW_CONNECTION_ID, sourceType: "cashflow", displayName: "Cashflow (mock)" });

  const dexResult = await ingestRawEvents(store, dexcom, [...glucoseNormalDay, ...glucoseVolatileDay]);
  const manResult = await ingestRawEvents(store, manual, manualNotesDay);
  const cashResult = await ingestRawEvents(store, cashflow, cashflowDay);

  console.log("Seed complete:", { dexcom: dexResult, manual: manResult, cashflow: cashResult });
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Type-check.** `pnpm exec tsc --noEmit` → clean. (Do not run the seed.)

- [ ] **Step 5: Commit.**
```bash
git add lib/constants.ts lib/db/sources.ts scripts/seed.ts
git commit -m "feat: add sources store, connector sync, cashflow seed"
```

---

## Task 4: Sources API + DTO (TDD for DTO)

**Files:** Create `lib/api/source-dto.ts` (+ test), `app/api/sources/route.ts`, `app/api/sources/[id]/sync/route.ts`.

- [ ] **Step 1: Failing DTO test** `lib/api/source-dto.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { serializeSources } from "@/lib/api/source-dto";

const row = (over: Partial<Record<string, unknown>>) => ({
  id: "c1", userId: "u", sourceType: "dexcom", displayName: "Dexcom (mock)", status: "active",
  createdAt: new Date(), updatedAt: new Date(), lastSyncAt: new Date("2026-06-01T10:00:00Z"), metadata: {}, ...over,
});

describe("serializeSources", () => {
  it("maps rows to id/sourceType/displayName/status/lastSyncAt(ISO|null)", () => {
    const out = serializeSources([row({}), row({ id: "c2", lastSyncAt: null })] as never);
    expect(out[0]).toEqual({ id: "c1", sourceType: "dexcom", displayName: "Dexcom (mock)", status: "active", lastSyncAt: "2026-06-01T10:00:00.000Z" });
    expect(out[1].lastSyncAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/api/source-dto.test.ts`.

- [ ] **Step 3: Implement `lib/api/source-dto.ts`:**
```ts
import type { sourceConnection } from "@/lib/db/schema";

type SourceRow = typeof sourceConnection.$inferSelect;

export interface SourceDTO {
  id: string;
  sourceType: string;
  displayName: string;
  status: string;
  lastSyncAt: string | null;
}

export function serializeSources(rows: SourceRow[]): SourceDTO[] {
  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    displayName: r.displayName,
    status: r.status,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
  }));
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/api/source-dto.test.ts` → passes.

- [ ] **Step 5: Create `app/api/sources/route.ts`** (GET list):
```ts
import { NextResponse } from "next/server";
import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listSourceConnections(SEED_USER_ID);
  return NextResponse.json({ sources: serializeSources(rows) });
}
```

- [ ] **Step 6: Create `app/api/sources/[id]/sync/route.ts`** (POST sync):
```ts
import { NextResponse } from "next/server";
import { runConnectorSync } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await runConnectorSync(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, { status: 202 });
}
```
> Next 16 passes route-segment `params` as a Promise — awaited above. If your installed types use a plain object, drop the `Promise<>` + `await`.

- [ ] **Step 7: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build` → clean; routes `/api/sources` and `/api/sources/[id]/sync` present; build works without `DATABASE_URL`.

- [ ] **Step 8: Commit.**
```bash
git add lib/api/source-dto.ts lib/api/source-dto.test.ts app/api/sources/route.ts "app/api/sources/[id]/sync/route.ts"
git commit -m "feat: add sources list + sync API and DTO"
```

---

## Task 5: `/sources` screen

**Files:** Create `components/sources/SourcesView.tsx`, `app/sources/page.tsx`.

- [ ] **Step 1: Create `components/sources/SourcesView.tsx`** (client — per-source sync):
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { SourceDTO } from "@/lib/api/source-dto";

export function SourcesView({ sources }: { sources: SourceDTO[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function sync(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/sources/${id}/sync`, { method: "POST" });
      const data = await res.json();
      setMsg((m) => ({ ...m, [id]: res.ok ? `synced: +${data.created} new` : `error: ${data.error}` }));
      router.refresh();
    } catch {
      setMsg((m) => ({ ...m, [id]: "sync failed" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
      {sources.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No sources configured.</div>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.displayName}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{s.sourceType}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{s.status}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.lastSyncAt ? `last sync ${new Date(s.lastSyncAt).toLocaleString()}` : "never synced"}
                  {msg[s.id] ? ` · ${msg[s.id]}` : ""}
                </div>
              </div>
              {s.sourceType === "manual" ? (
                <span className="text-xs text-muted-foreground">UI-logged</span>
              ) : (
                <Button type="button" onClick={() => sync(s.id)} disabled={busy === s.id}>
                  {busy === s.id ? "Syncing…" : "Sync"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/sources/page.tsx`** (server):
```tsx
import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { SourcesView } from "@/components/sources/SourcesView";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const rows = await listSourceConnections(SEED_USER_ID);
  return <SourcesView sources={serializeSources(rows)} />;
}
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build` → clean; `/sources` dynamic; build works without `DATABASE_URL`. `SourcesView` imports only the `SourceDTO` type (erased) — no `@/lib/db/*` in the client.

- [ ] **Step 4: Commit.**
```bash
git add components/sources/SourcesView.tsx app/sources/page.tsx
git commit -m "feat: build /sources screen with per-source sync"
```

---

## Task 6: Phase F verification gate (automated)

**Files:** none.

- [ ] **Step 1: tsc.** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2: lint.** `pnpm lint` → clean.
- [ ] **Step 3: tests.** `pnpm test` → prior (49) + cashflow normalize (1) + cashflow meta (1) + cashflow mock (1) + source-dto (1) = 53 pass. (Report the real count — exact totals depend on the in-branch baseline; the new Phase F tests must all pass.)
- [ ] **Step 4: build.** `pnpm build` → success; routes include `/sources`, `/api/sources`, `/api/sources/[id]/sync`, plus all prior; build works without `DATABASE_URL`.
- [ ] **Step 5: tree.** `git status -s` → only the intentional `components/timeline/AnnotationForm.tsx`; all Phase F files committed.

---

## Task 7: Manual verification against Railway (documented; run by Connor)

- [ ] `pnpm db:seed` (now also seeds the cashflow connection + transactions).
- [ ] `pnpm dev`, open `/sources`: expect three sources (Dexcom mock, Manual log, Cashflow mock) with status + last-sync; clicking **Sync** on Dexcom/Cashflow re-ingests (idempotent — no duplicate timeline rows) and updates last-sync.
- [ ] `/today?date=2026-06-01`: the **Finance** card now shows a real total ($246.50, 3 transactions) instead of "unknown".
- [ ] `/timeline?date=2026-06-01`: cashflow **transaction** events appear (source badge `cashflow`).
- [ ] `/insights?date=2026-06-01`: a **high_spend** insight now appears alongside the glucose insights.

**Phase F complete when:** the automated gate (Task 6) is green and the Task 7 run shows `/sources` syncing, finance lit up on `/today`, transactions on `/timeline`, and the high-spend insight on `/insights`.

---

## Self-Review

**Spec coverage:** `/sources` (list, status, last sync, manual sync trigger, mock-import-via-sync) → Tasks 3–5 ✓; Connector interface + Dexcom/Cashflow (mock) → Task 2 ✓; Cashflow consumed read-only, normalized to observations + timeline events → Task 1 ✓ (Blackbox owns no finance logic — it ingests transaction payloads). Cashflow data flowing also lights finance on `/today` (Phase D) + the high_spend insight (Phase E), advancing the "≥5 mock insights" target. Real OAuth/HTTP + Inngest-async sync explicitly deferred to G/post-v0.

**Placeholder scan:** full code in every step; the `params` Promise note + Railway run are explicit. No TODO/TBD. ✓

**Type consistency:** `CashflowTransactionPayload` (Task 1) used by normalize + extractRawMeta + mock data + connector. `Connector` (Task 2) implemented by both connectors + consumed by `getConnector` + `runConnectorSync`. `SourceDTO`/`serializeSources` (Task 4) used by both routes + `/sources` page. `runConnectorSync`/`listSourceConnections` (Task 3) used by routes + page. `SEED_CASHFLOW_CONNECTION_ID`, `ensureSourceConnection`, `ingestRawEvents`, `DbIngestStore`, `getConnector` referenced with correct names. ✓

---

## Execution Handoff

Subagent-driven. Pure TDD (Tasks 1, 2-mock, 4-DTO) + the phase get fresh-eyes review at the Task 6 gate. DB/connector/UI code is tsc/build-verified here and functionally confirmed by the Task 7 Railway run. After the gate: push; `gh pr create`/merge are agent-policy-blocked — hand the PR to Connor (push succeeds; provide the compare URL). After F, only Phase G (polish: README, `.env.example`, acceptance pass) remains.
