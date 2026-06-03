# Blackbox v0 — Phase C1: Data Layer (Ingest + Store + Seed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer that backs the timeline — a dependency-injected ingest pipeline (raw → normalize → persist, idempotent), a thin Drizzle-backed store, a timeline query, and a mock seed — with the orchestration logic tested DB-free via an in-memory store fake.

**Architecture:** The ingest *orchestration* (`lib/domain/ingest.ts`) is pure: it takes an injected `IngestStore` interface, so its idempotency and mapping can be unit-tested with an in-memory fake (no Postgres). The Drizzle implementation of that interface (`lib/db/store.ts`) is the thin impure boundary, verified by type-check + manual run against Railway. The seed feeds mock payloads through the *real* ingest pipeline (not hand-faked rows). This is Phase C1; the `/timeline` UI + API routes are Phase C2.

**Tech Stack:** Drizzle ORM (postgres) · Node crypto · Vitest. No new dependencies.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) (§Jobs/idempotency, §Seed/mock data). Builds on Phase B's schema + `lib/domain/{normalize,dedup,ordering,types}.ts`.

> Run all commands from repo root. Branch: `claude/blackbox-phase-c` (already created off `main`). **Environment:** `pnpm add` is policy-blocked (none needed here); file deletions are blocked (no task deletes); run `pnpm test`/`build` inside the implementing subagent. **No local DB** — DB-free unit tests are the gate; the seed/store run against a Railway Postgres (manual, documented in Task 5).

## Scope

In: timezone-naive (UTC) day range, pure raw-row builder + raw-meta extraction, idempotent ingest orchestration (injected store), Drizzle store impl + `getTimeline` query, mock data (glucose normal + volatile days, manual-notes day) + idempotent seed script. **Out (later):** cashflow/finance + insights seed (their phases), tz-aware day ranges, the `/timeline` UI and `/api/*` routes (Phase C2). `ON CONFLICT` upsert optimization (we use select-then-insert for simplicity/idempotency).

## File Structure (Phase C1)

- `lib/constants.ts` — **modify**: add fixed seed source-connection ids.
- `lib/domain/time.ts` + `time.test.ts` — `dayRange`.
- `lib/domain/ingest.ts` + `ingest.test.ts` — `RawEventRow`, `IngestStore`, `IngestResult`, `extractRawMeta`, `buildRawEventRow`, `ingestRawEvents`.
- `lib/db/store.ts` — Drizzle `DbIngestStore` (implements `IngestStore`) + `getTimeline`.
- `lib/mock/data.ts` + `data.test.ts` — seed payloads.
- `scripts/seed.ts` — seed runner; `package.json` `db:seed` script.

---

## Task 1: `dayRange` — UTC day boundaries (TDD)

**Files:** Create `lib/domain/time.ts`; Test `lib/domain/time.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `lib/domain/time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dayRange } from "@/lib/domain/time";

describe("dayRange", () => {
  it("returns the [start, end) UTC instants for a calendar date", () => {
    const { start, end } = dayRange("2026-06-01");
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });

  it("end is exactly 24h after start", () => {
    const { start, end } = dayRange("2026-12-31");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("throws on a malformed date", () => {
    expect(() => dayRange("2026-6-1")).toThrow();
    expect(() => dayRange("not-a-date")).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** Run: `pnpm test lib/domain/time.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/domain/time.ts`:**

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Half-open UTC instant range for a calendar date string "YYYY-MM-DD":
 *  [date T00:00:00Z, nextDay T00:00:00Z). v0 treats days as UTC;
 *  timezone-aware ranges are a later refinement. */
export function dayRange(date: string): { start: Date; end: Date } {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  }
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
```

- [ ] **Step 4: Run, verify PASS.** Run: `pnpm test lib/domain/time.test.ts`. Expected: PASS — 3 tests.

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/time.ts lib/domain/time.test.ts
git commit -m "feat: add UTC dayRange helper"
```

---

## Task 2: Raw-row builder + raw-meta extraction (TDD)

**Files:** Create `lib/domain/ingest.ts`; Test `lib/domain/ingest.test.ts`. Modify `lib/constants.ts`.

- [ ] **Step 1: Add seed connection ids to `lib/constants.ts`** (append):

```ts
// Fixed ids for the seed source connections, so re-seeding is idempotent.
export const SEED_MANUAL_CONNECTION_ID = "00000000-0000-4000-8000-000000000010";
export const SEED_DEXCOM_CONNECTION_ID = "00000000-0000-4000-8000-000000000011";
```

- [ ] **Step 2: Write the failing test.** Create `lib/domain/ingest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractRawMeta, buildRawEventRow } from "@/lib/domain/ingest";
import { payloadHash } from "@/lib/domain/dedup";

const manualConn = { id: "conn-m", userId: "user-1", sourceType: "manual" as const };
const dexcomConn = { id: "conn-d", userId: "user-1", sourceType: "dexcom" as const };

describe("extractRawMeta", () => {
  it("manual: no source record id, occurredAt from timestamp", () => {
    const meta = extractRawMeta("manual", { type: "note", title: "x", timestamp: "2026-06-01T09:00:00Z" });
    expect(meta.sourceRecordId).toBeNull();
    expect(meta.occurredAt.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("dexcom: source record id from recordId, occurredAt from timestamp", () => {
    const meta = extractRawMeta("dexcom", { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z", recordId: "r9" });
    expect(meta.sourceRecordId).toBe("r9");
    expect(meta.occurredAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("dexcom without recordId: null source record id", () => {
    const meta = extractRawMeta("dexcom", { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z" });
    expect(meta.sourceRecordId).toBeNull();
  });

  it("throws for a source type ingest does not support", () => {
    expect(() => extractRawMeta("garmin", {})).toThrow();
  });
});

describe("buildRawEventRow", () => {
  it("builds a raw_event row with hash + extracted meta", () => {
    const payload = { type: "meal", title: "Lunch", timestamp: "2026-06-01T12:00:00Z" };
    const row = buildRawEventRow(manualConn, payload);
    expect(row.sourceConnectionId).toBe("conn-m");
    expect(row.sourceType).toBe("manual");
    expect(row.sourceRecordId).toBeNull();
    expect(row.importBatchId).toBeNull();
    expect(row.occurredAt.toISOString()).toBe("2026-06-01T12:00:00.000Z");
    expect(row.payload).toBe(payload);
    expect(row.payloadHash).toBe(payloadHash(payload));
  });

  it("carries the dexcom source record id", () => {
    const row = buildRawEventRow(dexcomConn, { value: 7, unit: "mmol/L", timestamp: "2026-06-01T12:00:00Z", recordId: "r1" });
    expect(row.sourceRecordId).toBe("r1");
  });
});
```

- [ ] **Step 3: Run, verify FAIL.** Run: `pnpm test lib/domain/ingest.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Create `lib/domain/ingest.ts`** with the types + the two pure functions (the orchestration `ingestRawEvents` is added in Task 3):

```ts
import type { SourceType } from "@/lib/db/schema";
import type {
  DexcomReadingPayload,
  ManualAnnotationPayload,
} from "@/lib/domain/types";
import { payloadHash } from "@/lib/domain/dedup";

/** A source connection as the ingest pipeline needs it. */
export interface IngestConnection {
  id: string;
  userId: string;
  sourceType: SourceType;
}

/** A row ready to insert into raw_event (id + receivedAt are assigned by the DB). */
export interface RawEventRow {
  sourceConnectionId: string;
  importBatchId: string | null;
  sourceType: SourceType;
  sourceRecordId: string | null;
  occurredAt: Date;
  payload: unknown;
  payloadHash: string;
}

/** Per-source extraction of the dedupe id + the event's occurrence time. */
export function extractRawMeta(
  sourceType: SourceType,
  payload: unknown,
): { sourceRecordId: string | null; occurredAt: Date } {
  switch (sourceType) {
    case "manual": {
      const p = payload as ManualAnnotationPayload;
      return { sourceRecordId: null, occurredAt: new Date(p.timestamp) };
    }
    case "dexcom": {
      const p = payload as DexcomReadingPayload;
      return { sourceRecordId: p.recordId ?? null, occurredAt: new Date(p.timestamp) };
    }
    default:
      throw new Error(`ingest does not support source type: ${sourceType}`);
  }
}

/** Build a raw_event row from a connection + a source payload (pure). */
export function buildRawEventRow(conn: IngestConnection, payload: unknown): RawEventRow {
  const { sourceRecordId, occurredAt } = extractRawMeta(conn.sourceType, payload);
  return {
    sourceConnectionId: conn.id,
    importBatchId: null,
    sourceType: conn.sourceType,
    sourceRecordId,
    occurredAt,
    payload,
    payloadHash: payloadHash(payload),
  };
}
```

- [ ] **Step 5: Run, verify PASS.** Run: `pnpm test lib/domain/ingest.test.ts`. Expected: PASS — 6 tests.

- [ ] **Step 6: Commit.**
```bash
git add lib/constants.ts lib/domain/ingest.ts lib/domain/ingest.test.ts
git commit -m "feat: add raw-event row builder and source meta extraction"
```

---

## Task 3: Idempotent ingest orchestration (TDD, injected store)

**Files:** Modify `lib/domain/ingest.ts`; Modify `lib/domain/ingest.test.ts`.

- [ ] **Step 1: Append the failing orchestration test** to `lib/domain/ingest.test.ts`:

```ts
import { ingestRawEvents, type IngestStore, type RawEventRow as Row } from "@/lib/domain/ingest";
import { rawEventDedupeKey } from "@/lib/domain/dedup";
import type { NormalizedObservation, NormalizedTimelineEvent } from "@/lib/domain/types";

/** In-memory IngestStore: dedupes raw events by their natural key, mirroring
 *  the DB's partial unique indexes, so we can test pipeline idempotency DB-free. */
function makeMemoryStore() {
  const rawByKey = new Map<string, { id: string; row: Row }>();
  const observations = new Map<string, NormalizedObservation>(); // key: rawEventId|metric
  const timelineEvents = new Map<string, NormalizedTimelineEvent>(); // key: rawEventId
  let seq = 0;
  const store: IngestStore = {
    async upsertRawEvent(row) {
      const key = rawEventDedupeKey({
        sourceConnectionId: row.sourceConnectionId,
        sourceRecordId: row.sourceRecordId,
        payloadHash: row.payloadHash,
      });
      const existing = rawByKey.get(key);
      if (existing) return { id: existing.id, created: false };
      const id = `raw-${++seq}`;
      rawByKey.set(key, { id, row });
      return { id, created: true };
    },
    async upsertObservation(obs) {
      observations.set(`${obs.rawEventId}|${obs.metric}`, obs);
    },
    async upsertTimelineEvent(ev) {
      timelineEvents.set(`${ev.rawEventId}`, ev);
    },
  };
  return { store, rawByKey, observations, timelineEvents };
}

describe("ingestRawEvents", () => {
  const dexcomConn = { id: "conn-d", userId: "user-1", sourceType: "dexcom" as const };
  const payloads = [
    { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T10:00:00Z", recordId: "r1" },
    { value: 7.1, unit: "mmol/L", timestamp: "2026-06-01T10:05:00Z", recordId: "r2" },
  ];

  it("persists raw events and their normalized observations with attribution", async () => {
    const { store, rawByKey, observations } = makeMemoryStore();
    const result = await ingestRawEvents(store, dexcomConn, payloads);
    expect(result).toEqual({ found: 2, created: 2, observations: 2, timelineEvents: 0 });
    expect(rawByKey.size).toBe(2);
    expect(observations.size).toBe(2);
    const obs = [...observations.values()];
    expect(obs.every((o) => o.metric === "glucose" && o.userId === "user-1")).toBe(true);
    expect(obs.every((o) => o.rawEventId.startsWith("raw-"))).toBe(true);
  });

  it("is idempotent: re-ingesting the same payloads creates no duplicates", async () => {
    const { store, rawByKey, observations } = makeMemoryStore();
    await ingestRawEvents(store, dexcomConn, payloads);
    const second = await ingestRawEvents(store, dexcomConn, payloads);
    expect(second.created).toBe(0);
    expect(rawByKey.size).toBe(2);
    expect(observations.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify the new test FAILS.** Run: `pnpm test lib/domain/ingest.test.ts`. Expected: the Task-2 tests still pass; the `ingestRawEvents` tests FAIL (`ingestRawEvents`/`IngestStore` not exported).

- [ ] **Step 3: Append the store interface + orchestration to `lib/domain/ingest.ts`:**

```ts
import { normalize } from "@/lib/domain/normalize";
import type {
  NormalizedObservation,
  NormalizedTimelineEvent,
  RawEventInput,
} from "@/lib/domain/types";

/** Persistence boundary for ingest. The DB implementation lives in lib/db/store.ts;
 *  tests inject an in-memory fake. `upsertRawEvent` returns the row id and whether
 *  it was newly created (false = an equivalent raw event already existed). */
export interface IngestStore {
  upsertRawEvent(row: RawEventRow): Promise<{ id: string; created: boolean }>;
  upsertObservation(obs: NormalizedObservation): Promise<void>;
  upsertTimelineEvent(ev: NormalizedTimelineEvent): Promise<void>;
}

export interface IngestResult {
  found: number;
  created: number;
  observations: number;
  timelineEvents: number;
}

/** Run payloads through the pipeline: build + upsert raw events, then normalize
 *  each and upsert its observations/timeline events. Idempotent — repeated runs
 *  dedupe at upsertRawEvent and overwrite normalized rows in place. */
export async function ingestRawEvents(
  store: IngestStore,
  conn: IngestConnection,
  payloads: unknown[],
): Promise<IngestResult> {
  let created = 0;
  let observations = 0;
  let timelineEvents = 0;

  for (const payload of payloads) {
    const row = buildRawEventRow(conn, payload);
    const { id, created: isNew } = await store.upsertRawEvent(row);
    if (isNew) created += 1;

    const rawInput: RawEventInput = {
      id,
      userId: conn.userId,
      sourceConnectionId: conn.id,
      sourceType: conn.sourceType,
      sourceRecordId: row.sourceRecordId,
      occurredAt: row.occurredAt,
      payload,
    };
    const normalized = normalize(rawInput);
    for (const obs of normalized.observations) {
      await store.upsertObservation(obs);
      observations += 1;
    }
    for (const ev of normalized.timelineEvents) {
      await store.upsertTimelineEvent(ev);
      timelineEvents += 1;
    }
  }

  return { found: payloads.length, created, observations, timelineEvents };
}
```

- [ ] **Step 4: Run, verify ALL pass.** Run: `pnpm test lib/domain/ingest.test.ts`. Expected: PASS — 8 tests (6 from Task 2 + 2 orchestration).

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/ingest.ts lib/domain/ingest.test.ts
git commit -m "feat: add idempotent ingest orchestration over an injected store"
```

---

## Task 4: Drizzle store + timeline query

**Files:** Create `lib/db/store.ts`.

This is the thin impure boundary (real DB). It implements `IngestStore` with select-then-insert (idempotent, avoids `ON CONFLICT` against partial indexes) and adds `getTimeline`. No DB-free unit test; verified by `tsc` here and by the seed run (Task 5) against Railway.

- [ ] **Step 1: Create `lib/db/store.ts`:**

```ts
import { and, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { observation, rawEvent, timelineEvent } from "@/lib/db/schema";
import { dayRange } from "@/lib/domain/time";
import type {
  IngestStore,
  RawEventRow,
} from "@/lib/domain/ingest";
import type {
  NormalizedObservation,
  NormalizedTimelineEvent,
} from "@/lib/domain/types";

type Db = ReturnType<typeof getDb>;

/** Drizzle-backed ingest store. Uses select-then-insert for idempotency
 *  (mirrors raw_event's partial unique indexes without ON CONFLICT gymnastics). */
export class DbIngestStore implements IngestStore {
  constructor(private readonly db: Db = getDb()) {}

  async upsertRawEvent(row: RawEventRow): Promise<{ id: string; created: boolean }> {
    const where =
      row.sourceRecordId !== null
        ? and(
            eq(rawEvent.sourceConnectionId, row.sourceConnectionId),
            eq(rawEvent.sourceRecordId, row.sourceRecordId),
          )
        : and(
            eq(rawEvent.sourceConnectionId, row.sourceConnectionId),
            eq(rawEvent.payloadHash, row.payloadHash),
          );

    const [existing] = await this.db
      .select({ id: rawEvent.id })
      .from(rawEvent)
      .where(where)
      .limit(1);
    if (existing) return { id: existing.id, created: false };

    const [inserted] = await this.db
      .insert(rawEvent)
      .values({
        sourceConnectionId: row.sourceConnectionId,
        importBatchId: row.importBatchId,
        sourceType: row.sourceType,
        sourceRecordId: row.sourceRecordId,
        occurredAt: row.occurredAt,
        payload: row.payload,
        payloadHash: row.payloadHash,
      })
      .returning({ id: rawEvent.id });
    return { id: inserted.id, created: true };
  }

  async upsertObservation(obs: NormalizedObservation): Promise<void> {
    const [existing] = await this.db
      .select({ id: observation.id })
      .from(observation)
      .where(and(eq(observation.rawEventId, obs.rawEventId), eq(observation.metric, obs.metric)))
      .limit(1);
    const values = {
      userId: obs.userId,
      rawEventId: obs.rawEventId,
      sourceType: obs.sourceType,
      metric: obs.metric as NormalizedObservation["metric"],
      value: obs.value,
      unit: obs.unit,
      observedAt: obs.observedAt,
      metadata: obs.metadata,
    };
    if (existing) {
      await this.db.update(observation).set(values).where(eq(observation.id, existing.id));
    } else {
      await this.db.insert(observation).values(values);
    }
  }

  async upsertTimelineEvent(ev: NormalizedTimelineEvent): Promise<void> {
    if (ev.rawEventId === null) {
      await this.db.insert(timelineEvent).values(toTimelineValues(ev));
      return;
    }
    const [existing] = await this.db
      .select({ id: timelineEvent.id })
      .from(timelineEvent)
      .where(eq(timelineEvent.rawEventId, ev.rawEventId))
      .limit(1);
    if (existing) {
      await this.db.update(timelineEvent).set(toTimelineValues(ev)).where(eq(timelineEvent.id, existing.id));
    } else {
      await this.db.insert(timelineEvent).values(toTimelineValues(ev));
    }
  }
}

function toTimelineValues(ev: NormalizedTimelineEvent) {
  return {
    userId: ev.userId,
    rawEventId: ev.rawEventId,
    sourceType: ev.sourceType,
    eventType: ev.eventType as NormalizedTimelineEvent["eventType"],
    title: ev.title,
    description: ev.description,
    startedAt: ev.startedAt,
    endedAt: ev.endedAt,
    metadata: ev.metadata,
  };
}

/** Timeline events + glucose observations for one UTC calendar day. */
export async function getTimeline(userId: string, date: string, db: Db = getDb()) {
  const { start, end } = dayRange(date);
  const events = await db
    .select()
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.userId, userId),
        gte(timelineEvent.startedAt, start),
        lt(timelineEvent.startedAt, end),
      ),
    );
  const observations = await db
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.userId, userId),
        gte(observation.observedAt, start),
        lt(observation.observedAt, end),
      ),
    );
  return { events, observations };
}
```

> Note: the `as` casts on `metric`/`eventType` bridge the domain's `string` typing to the schema's narrower `$type` unions; the domain guarantees valid values. The `db` parameter is injectable for a future gated integration test.

- [ ] **Step 2: Type-check.** Run: `pnpm exec tsc --noEmit`. Expected: no errors. If the drizzle insert/`.values()` types reject a field (e.g. `metric`/`eventType` cast, `metadata` json), report the exact error and adjust the cast minimally — do not change the schema.

- [ ] **Step 3: Commit.**
```bash
git add lib/db/store.ts
git commit -m "feat: add drizzle ingest store and timeline query"
```

---

## Task 5: Mock data + seed script

**Files:** Create `lib/mock/data.ts`, `lib/mock/data.test.ts`, `scripts/seed.ts`; Modify `package.json`.

- [ ] **Step 1: Write the failing mock-data test.** Create `lib/mock/data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";

describe("mock data", () => {
  it("normal glucose day is a non-empty series of mmol/L readings with ids", () => {
    expect(glucoseNormalDay.length).toBeGreaterThan(0);
    expect(glucoseNormalDay.every((r) => r.unit === "mmol/L" && typeof r.value === "number" && r.recordId)).toBe(true);
  });

  it("volatile glucose day swings wider than the normal day", () => {
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(range(glucoseVolatileDay.map((r) => r.value))).toBeGreaterThan(range(glucoseNormalDay.map((r) => r.value)));
  });

  it("manual notes day has meal/insulin/stress annotations", () => {
    const types = manualNotesDay.map((a) => a.type);
    expect(types).toContain("meal");
    expect(types).toContain("insulin");
    expect(types).toContain("stress");
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** Run: `pnpm test lib/mock/data.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Create `lib/mock/data.ts`:**

```ts
import type { DexcomReadingPayload, ManualAnnotationPayload } from "@/lib/domain/types";

const D = "2026-06-01";

function reading(idx: number, hour: number, value: number): DexcomReadingPayload {
  const hh = String(hour).padStart(2, "0");
  return { value, unit: "mmol/L", timestamp: `${D}T${hh}:00:00Z`, recordId: `normal-${idx}`, trend: "flat" };
}

/** A calm, in-range glucose day (~4.5–7.5 mmol/L). */
export const glucoseNormalDay: DexcomReadingPayload[] = [
  reading(1, 6, 5.2), reading(2, 8, 6.1), reading(3, 10, 5.8), reading(4, 12, 6.7),
  reading(5, 14, 6.0), reading(6, 16, 5.5), reading(7, 18, 6.3), reading(8, 20, 5.9),
];

/** A volatile day with spikes and a low (~3.2–13.5 mmol/L). */
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
```

- [ ] **Step 4: Run, verify PASS.** Run: `pnpm test lib/mock/data.test.ts`. Expected: PASS — 3 tests.

- [ ] **Step 5: Create `scripts/seed.ts`** (idempotent seed runner):

```ts
import { getDb } from "@/lib/db/client";
import { sourceConnection } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents, type IngestConnection } from "@/lib/domain/ingest";
import {
  SEED_USER_ID,
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";

async function ensureConnection(conn: {
  id: string;
  sourceType: IngestConnection["sourceType"];
  displayName: string;
}): Promise<IngestConnection> {
  const db = getDb();
  const [existing] = await db
    .select({ id: sourceConnection.id })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, conn.id))
    .limit(1);
  if (!existing) {
    await db.insert(sourceConnection).values({
      id: conn.id,
      userId: SEED_USER_ID,
      sourceType: conn.sourceType,
      displayName: conn.displayName,
      status: "active",
    });
  }
  return { id: conn.id, userId: SEED_USER_ID, sourceType: conn.sourceType };
}

async function main() {
  const store = new DbIngestStore();

  const dexcom = await ensureConnection({
    id: SEED_DEXCOM_CONNECTION_ID,
    sourceType: "dexcom",
    displayName: "Dexcom (mock)",
  });
  const manual = await ensureConnection({
    id: SEED_MANUAL_CONNECTION_ID,
    sourceType: "manual",
    displayName: "Manual log",
  });

  const dexResult = await ingestRawEvents(store, dexcom, [...glucoseNormalDay, ...glucoseVolatileDay]);
  const manResult = await ingestRawEvents(store, manual, manualNotesDay);

  console.log("Seed complete:", { dexcom: dexResult, manual: manResult });
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 6: Add the `db:seed` script to `package.json`** (inside `"scripts"`):

```json
"db:seed": "tsx scripts/seed.ts"
```

> `tsx` is required to run the TS seed script with `@/` alias resolution. It is NOT currently a dependency, and `pnpm add` is policy-blocked. Add it manually: edit `package.json` `devDependencies` to include `"tsx": "^4.19.2"`, then run `pnpm install`. If tsx's `@/` alias resolution needs config, the script can instead be run with `pnpm exec tsx --tsconfig tsconfig.json scripts/seed.ts` — tsx reads `tsconfig.json` `paths` by default, so `@/` should resolve.

- [ ] **Step 7: Type-check (do NOT run the seed — no local DB).** Run: `pnpm exec tsc --noEmit`. Expected: no errors. The seed is run later against Railway (see below).

- [ ] **Step 8: Commit.**
```bash
git add lib/mock/data.ts lib/mock/data.test.ts scripts/seed.ts package.json pnpm-lock.yaml
git commit -m "feat: add mock data and idempotent seed script"
```

> **Running the seed (manual, against Railway — documented for Phase C2/verification):** set `DATABASE_URL` in `.env.local` to a Railway Postgres, apply the migration (`pnpm db:migrate`), then `pnpm db:seed`. Re-running `db:seed` must not duplicate rows (idempotent via fixed connection ids + raw-event dedupe). This is not part of the automated gate.

---

## Task 6: Phase C1 verification gate

**Files:** none.

- [ ] **Step 1: Type-check.** Run: `pnpm exec tsc --noEmit`. Expected: no errors.
- [ ] **Step 2: Lint.** Run: `pnpm lint`. Expected: clean.
- [ ] **Step 3: Tests.** Run: `pnpm test`. Expected: all pass — Phase A/B (22) + time (3) + ingest (8) + mock data (3) = 36.
- [ ] **Step 4: Build.** Run: `pnpm build`. Expected: success; routes `/`, `/today`, `/api/health` present (no new routes this phase).
- [ ] **Step 5: Tree clean.** Run: `git status -s` (expect empty).

**Phase C1 complete when:** the ingest pipeline + store + timeline query + seed are implemented, the orchestration is proven idempotent by DB-free tests, all 36 tests + tsc + lint + build are green. (Actual seeded data on Railway is verified during Phase C2, which renders it.)

---

## Self-Review

**Spec coverage (C1 slice):** idempotent import/normalize pipeline (Tasks 2–3, proven via in-memory fake) → build-requirements §Jobs idempotency ✓; raw payloads preserved + source attribution (buildRawEventRow keeps `payload`; normalized rows carry userId/rawEventId) ✓; mock data feeds the *real* pipeline (Task 5 seed → ingestRawEvents → normalize) → §Seed/mock ✓ (glucose normal/volatile + manual; finance/insights deferred to their phases, stated in Scope); timeline query for a date (Task 4 getTimeline) backs the §/timeline screen built in C2 ✓.

**Placeholder scan:** every code step has full code; the `db:seed`/tsx dependency caveat and the "run against Railway" step are explicit instructions, not gaps. No TODO/TBD. ✓

**Type consistency:** `IngestConnection`/`RawEventRow`/`IngestStore`/`IngestResult` defined in `ingest.ts` (Tasks 2–3) and used by `store.ts` (Task 4) + `seed.ts` (Task 5). `getDb` (Phase A), `normalize`/`rawEventDedupeKey`/`payloadHash` (Phase B), schema tables (Phase B) referenced with correct names. The in-memory fake in the test implements the same `IngestStore` interface the Drizzle store implements. `metric`/`eventType` `as` casts are called out in Task 4. ✓

---

## Execution Handoff

Subagent-driven (per prior phases). Pure TDD tasks (1–3, 5-data) get fresh-eyes review via the Task 6 whole-branch gate; the Drizzle store (Task 4) is the impure boundary — type-checked here, functionally verified by the Railway seed run during C2.
