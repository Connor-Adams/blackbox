# Blackbox v0 — Phase B: Schema + Domain Normalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the full Postgres schema (the 8 core tables) with idempotency constraints and generate the first migration, then build the pure, DB-free domain layer (`normalize`, dedup keys, timeline ordering) with unit tests.

**Architecture:** Drizzle table definitions in `lib/db/schema.ts` mirror build-requirements' core data model; idempotency is enforced by partial unique indexes on `raw_event`. The domain layer in `lib/domain/` is pure (no DB imports): `normalize(rawEvent)` maps a raw source payload to normalized `{ observations, timelineEvents }`, carrying source attribution and a `rawEventId` back-reference. Pure functions make the spec's required tests runnable with fixtures and no Postgres.

**Tech Stack:** Drizzle ORM (pg-core) · postgres dialect · drizzle-kit · Vitest · Node crypto.

**Spec:** [docs/superpowers/specs/2026-06-02-blackbox-v0-design.md](../specs/2026-06-02-blackbox-v0-design.md) · field-level source of truth: [docs/build-requirements.md](../../build-requirements.md) §Core domain model.

> Run all commands from repo root. Branch: `claude/blackbox-phase-b` (already created off `main`). Environment notes carried from Phase A: `pnpm add` is policy-blocked (edit `package.json` + `pnpm install` instead); file deletions (`rm`/`git rm`) are blocked (don't write tasks that delete); run `pnpm test`/`build` inside the implementing subagent, not as a bare controller command.

---

## Scope

In scope: all 8 tables + first migration; domain `normalize` for the `manual` and `dexcom` sources; dedup-key derivation; timeline ordering; unit tests for each. **Out of scope (later phases):** cashflow normalization (Phase F, with its connector), snapshot/insight computation and their precise JSON types (Phases D/E), seed/mock data and UI (Phase C+), running migrations against a DB (happens on Railway deploy).

JSON columns whose precise shapes belong to later phases (`daily_snapshot.summary_json`, `insight.evidence_json`) are typed as `Record<string, unknown>` here and refined when those phases compute them.

## File Structure (Phase B)

- `lib/constants.ts` — `SEED_USER_ID` (single-user v0).
- `lib/db/schema.ts` — **replace the empty placeholder** with all 8 tables + exported enum-union types.
- `drizzle/0000_*.sql` + `drizzle/meta/*` — generated migration (Task 2).
- `lib/domain/types.ts` — normalized output types + source payload types + `RawEventInput`.
- `lib/domain/dedup.ts` — `payloadHash`, `stableStringify`, `rawEventDedupeKey`.
- `lib/domain/normalize.ts` — `normalize(rawEvent)` dispatcher + per-source normalizers.
- `lib/domain/ordering.ts` — `orderTimeline`.
- Tests: `lib/domain/dedup.test.ts`, `lib/domain/normalize.test.ts`, `lib/domain/ordering.test.ts`.

---

## Task 1: Define the full Drizzle schema

**Files:**
- Create: `lib/constants.ts`
- Modify (replace contents): `lib/db/schema.ts`

- [ ] **Step 1: Create `lib/constants.ts`**

```ts
// Single-user v0: a fixed user id used server-side until auth lands.
// Valid UUID (version 4, variant 8) so it satisfies uuid columns.
export const SEED_USER_ID = "00000000-0000-4000-8000-000000000001";
```

- [ ] **Step 2: Replace `lib/db/schema.ts`** with the full schema (8 tables + union types):

```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---- Enum-like unions (text columns; flexible, no enum migrations needed) ----
export const sourceTypes = ["manual", "cashflow", "dexcom", "calendar", "garmin", "healthkit"] as const;
export type SourceType = (typeof sourceTypes)[number];

export const sourceStatuses = ["active", "disconnected", "error"] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export const importStatuses = ["pending", "running", "success", "error"] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const observationMetrics = [
  "glucose", "cash_balance", "daily_spend", "transaction_amount",
  "heart_rate", "hrv", "stress", "steps", "sleep_duration", "body_battery",
] as const;
export type ObservationMetric = (typeof observationMetrics)[number];

export const timelineEventTypes = [
  "manual_note", "meal", "insulin", "glucose_event", "transaction", "cashflow_summary",
  "sleep", "workout", "calendar_block", "travel", "stress_event",
] as const;
export type TimelineEventType = (typeof timelineEventTypes)[number];

export const annotationTypes = [
  "note", "meal", "insulin", "exercise", "sick", "travel", "stress", "caffeine", "alcohol", "medication",
] as const;
export type AnnotationType = (typeof annotationTypes)[number];

export const insightSeverities = ["info", "notice", "warning", "critical"] as const;
export type InsightSeverity = (typeof insightSeverities)[number];

export const insightStatuses = ["active", "dismissed", "archived"] as const;
export type InsightStatus = (typeof insightStatuses)[number];

type Json = Record<string, unknown>;

// ---- Tables ----

export const sourceConnection = pgTable("source_connection", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  sourceType: text("source_type").$type<SourceType>().notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").$type<SourceStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Json>().notNull().default({}),
});

export const importBatch = pgTable("import_batch", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceConnectionId: uuid("source_connection_id").notNull().references(() => sourceConnection.id),
  status: text("status").$type<ImportStatus>().notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsFound: integer("records_found").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  error: text("error"),
  metadata: jsonb("metadata").$type<Json>().notNull().default({}),
});

export const rawEvent = pgTable(
  "raw_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceConnectionId: uuid("source_connection_id").notNull().references(() => sourceConnection.id),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    sourceRecordId: text("source_record_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    payloadHash: text("payload_hash").notNull(),
  },
  (t) => [
    // Idempotency: dedupe on (connection, sourceRecordId) when a source id exists,
    // else fall back to (connection, payloadHash). Partial indexes keep the two cases disjoint.
    uniqueIndex("raw_event_source_record_uq")
      .on(t.sourceConnectionId, t.sourceRecordId)
      .where(sql`${t.sourceRecordId} is not null`),
    uniqueIndex("raw_event_payload_hash_uq")
      .on(t.sourceConnectionId, t.payloadHash)
      .where(sql`${t.sourceRecordId} is null`),
  ],
);

export const observation = pgTable(
  "observation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    rawEventId: uuid("raw_event_id").notNull().references(() => rawEvent.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    metric: text("metric").$type<ObservationMetric>().notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
  },
  (t) => [
    index("observation_user_metric_time_idx").on(t.userId, t.metric, t.observedAt),
    uniqueIndex("observation_raw_metric_uq").on(t.rawEventId, t.metric),
  ],
);

export const timelineEvent = pgTable(
  "timeline_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    rawEventId: uuid("raw_event_id").references(() => rawEvent.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    eventType: text("event_type").$type<TimelineEventType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
  },
  (t) => [
    index("timeline_event_user_time_idx").on(t.userId, t.startedAt),
    uniqueIndex("timeline_event_raw_uq")
      .on(t.rawEventId)
      .where(sql`${t.rawEventId} is not null`),
  ],
);

export const annotation = pgTable(
  "annotation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    type: text("type").$type<AnnotationType>().notNull(),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("annotation_user_time_idx").on(t.userId, t.startedAt)],
);

export const dailySnapshot = pgTable(
  "daily_snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    timezone: text("timezone").notNull(),
    // Precise shape computed/typed in Phase D.
    summaryJson: jsonb("summary_json").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_snapshot_user_date_uq").on(t.userId, t.date)],
);

export const insight = pgTable(
  "insight",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date"),
    timeRangeStart: timestamp("time_range_start", { withTimezone: true }).notNull(),
    timeRangeEnd: timestamp("time_range_end", { withTimezone: true }).notNull(),
    insightType: text("insight_type").notNull(),
    severity: text("severity").$type<InsightSeverity>().notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    // Precise shape computed/typed in Phase E.
    evidenceJson: jsonb("evidence_json").$type<Json>().notNull().default({}),
    sourceObservationIds: jsonb("source_observation_ids").$type<string[]>().notNull().default([]),
    sourceTimelineEventIds: jsonb("source_timeline_event_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<InsightStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insight_user_date_idx").on(t.userId, t.date)],
);
```

- [ ] **Step 3: Type-check.** Run: `pnpm exec tsc --noEmit`. Expected: no errors. (`lib/db/client.ts`'s `import * as schema` now picks up real tables; that is fine.)

- [ ] **Step 4: Commit.**
```bash
git add lib/constants.ts lib/db/schema.ts
git commit -m "feat: define core drizzle schema (8 tables + idempotency indexes)"
```

---

## Task 2: Generate the initial migration

**Files:**
- Create (generated): `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`

drizzle-kit reads `drizzle.config.ts` + `lib/db/schema.ts` and emits SQL offline (no DB connection needed for `generate`).

- [ ] **Step 1: Generate the migration.** Run: `pnpm db:generate`
Expected: prints something like `8 tables ... [✓] Your SQL migration file ➜ drizzle/0000_*.sql`. If it asks for a name non-interactively and fails, run `pnpm exec drizzle-kit generate --name init`.

- [ ] **Step 2: Verify the SQL.** Run: `cat drizzle/0000_*.sql`
Expected: 8 `CREATE TABLE` statements (`source_connection`, `import_batch`, `raw_event`, `observation`, `timeline_event`, `annotation`, `daily_snapshot`, `insight`), the two partial unique indexes on `raw_event` (`... WHERE "source_record_id" IS NOT NULL` and `... IS NULL`), the unique indexes on `observation` (raw+metric), `timeline_event` (partial on raw), `daily_snapshot` (user+date), and the FK constraints. No DB connection is attempted.

- [ ] **Step 3: Commit.**
```bash
git add drizzle
git commit -m "feat: generate initial schema migration"
```

---

## Task 3: Domain types + dedup keys (TDD)

**Files:**
- Create: `lib/domain/types.ts`
- Create: `lib/domain/dedup.ts`
- Test: `lib/domain/dedup.test.ts`

- [ ] **Step 1: Create `lib/domain/types.ts`** (shared shapes; no logic, so no test of its own):

```ts
import type { SourceType } from "@/lib/db/schema";

/** A raw event as seen by the pure normalizer. `userId` is resolved by the
 *  caller from the owning source connection (raw_event itself has no userId). */
export interface RawEventInput {
  id: string;
  userId: string;
  sourceConnectionId: string;
  sourceType: SourceType;
  sourceRecordId: string | null;
  occurredAt: Date;
  payload: unknown;
}

export interface NormalizedObservation {
  userId: string;
  rawEventId: string;
  sourceType: SourceType;
  metric: string;
  value: number;
  unit: string;
  observedAt: Date;
  metadata: Record<string, unknown>;
}

export interface NormalizedTimelineEvent {
  userId: string;
  rawEventId: string | null;
  sourceType: SourceType;
  eventType: string;
  title: string;
  description: string | null;
  startedAt: Date;
  endedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface NormalizeResult {
  observations: NormalizedObservation[];
  timelineEvents: NormalizedTimelineEvent[];
}

/** Manual annotation payload carried inside a manual-source raw event. */
export interface ManualAnnotationPayload {
  type:
    | "note" | "meal" | "insulin" | "exercise" | "sick"
    | "travel" | "stress" | "caffeine" | "alcohol" | "medication";
  title: string;
  timestamp: string; // ISO 8601
  endTimestamp?: string; // ISO 8601
  notes?: string;
  metadata?: Record<string, unknown>;
}

/** Dexcom glucose reading payload carried inside a dexcom-source raw event. */
export interface DexcomReadingPayload {
  value: number;
  unit: string; // e.g. "mmol/L"
  timestamp: string; // ISO 8601
  trend?: string;
  trendRate?: number;
  recordId?: string;
}
```

- [ ] **Step 2: Write the failing test.** Create `lib/domain/dedup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { payloadHash, stableStringify, rawEventDedupeKey } from "@/lib/domain/dedup";

describe("stableStringify", () => {
  it("is order-independent for object keys", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it("distinguishes different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("payloadHash", () => {
  it("is deterministic regardless of key order", () => {
    expect(payloadHash({ x: 1, y: [2, 3] })).toBe(payloadHash({ y: [2, 3], x: 1 }));
  });
  it("changes when the payload changes", () => {
    expect(payloadHash({ x: 1 })).not.toBe(payloadHash({ x: 2 }));
  });
});

describe("rawEventDedupeKey", () => {
  it("keys on sourceRecordId when present", () => {
    const key = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h1" });
    expect(key).toBe("c1:id:r1");
  });
  it("falls back to payloadHash when sourceRecordId is null", () => {
    const key = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: null, payloadHash: "h1" });
    expect(key).toBe("c1:hash:h1");
  });
  it("is stable for the same inputs (idempotent imports map to the same key)", () => {
    const a = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h1" });
    const b = rawEventDedupeKey({ sourceConnectionId: "c1", sourceRecordId: "r1", payloadHash: "h2" });
    expect(a).toBe(b); // hash differing doesn't matter when a sourceRecordId exists
  });
});
```

- [ ] **Step 3: Run the test, verify it FAILS.** Run: `pnpm test lib/domain/dedup.test.ts`. Expected: FAIL — cannot resolve `@/lib/domain/dedup`.

- [ ] **Step 4: Implement `lib/domain/dedup.ts`:**

```ts
import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively so logically-equal
 *  payloads serialize identically. Arrays keep their order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 of the canonical payload — stable across key ordering. */
export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/** The natural dedupe key for a raw event: prefer the source's own record id,
 *  fall back to the payload hash when none is available. Mirrors the partial
 *  unique indexes on raw_event. */
export function rawEventDedupeKey(input: {
  sourceConnectionId: string;
  sourceRecordId: string | null;
  payloadHash: string;
}): string {
  return input.sourceRecordId !== null
    ? `${input.sourceConnectionId}:id:${input.sourceRecordId}`
    : `${input.sourceConnectionId}:hash:${input.payloadHash}`;
}
```

- [ ] **Step 5: Run the test, verify it PASSES.** Run: `pnpm test lib/domain/dedup.test.ts`. Expected: PASS — 6 tests.

- [ ] **Step 6: Commit.**
```bash
git add lib/domain/types.ts lib/domain/dedup.ts lib/domain/dedup.test.ts
git commit -m "feat: add domain types and raw-event dedup keys"
```

---

## Task 4: Normalize the `manual` source (TDD)

**Files:**
- Create: `lib/domain/normalize.ts`
- Test: `lib/domain/normalize.test.ts`

- [ ] **Step 1: Write the failing test.** Create `lib/domain/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/domain/normalize";
import type { RawEventInput } from "@/lib/domain/types";

const base = {
  id: "raw-1",
  userId: "user-1",
  sourceConnectionId: "conn-1",
  sourceRecordId: null,
  occurredAt: new Date("2026-06-01T12:00:00Z"),
} as const;

describe("normalize: manual", () => {
  it("maps a manual meal annotation to a timeline event with attribution", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "meal", title: "Lunch", timestamp: "2026-06-01T12:30:00Z", notes: "pasta" },
    };
    const { observations, timelineEvents } = normalize(raw);
    expect(observations).toEqual([]);
    expect(timelineEvents).toHaveLength(1);
    const ev = timelineEvents[0];
    expect(ev.eventType).toBe("meal");
    expect(ev.sourceType).toBe("manual");
    expect(ev.rawEventId).toBe("raw-1");
    expect(ev.userId).toBe("user-1");
    expect(ev.title).toBe("Lunch");
    expect(ev.description).toBe("pasta");
    expect(ev.startedAt.toISOString()).toBe("2026-06-01T12:30:00.000Z");
    expect(ev.endedAt).toBeNull();
    expect(ev.metadata.annotationType).toBe("meal");
  });

  it("maps an unknown annotation type to manual_note and records the original type", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "caffeine", title: "Coffee", timestamp: "2026-06-01T08:00:00Z" },
    };
    const ev = normalize(raw).timelineEvents[0];
    expect(ev.eventType).toBe("manual_note");
    expect(ev.metadata.annotationType).toBe("caffeine");
    expect(ev.description).toBeNull();
  });

  it("carries an end timestamp when provided", () => {
    const raw: RawEventInput = {
      ...base,
      sourceType: "manual",
      payload: { type: "travel", title: "Flight", timestamp: "2026-06-01T06:00:00Z", endTimestamp: "2026-06-01T10:00:00Z" },
    };
    const ev = normalize(raw).timelineEvents[0];
    expect(ev.eventType).toBe("travel");
    expect(ev.endedAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("returns empty for an unsupported source type", () => {
    const raw: RawEventInput = { ...base, sourceType: "garmin", payload: {} };
    expect(normalize(raw)).toEqual({ observations: [], timelineEvents: [] });
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.** Run: `pnpm test lib/domain/normalize.test.ts`. Expected: FAIL — cannot resolve `@/lib/domain/normalize`.

- [ ] **Step 3: Implement `lib/domain/normalize.ts`** (dispatcher + manual normalizer; dexcom added in Task 5):

```ts
import type { AnnotationType, TimelineEventType } from "@/lib/db/schema";
import type {
  ManualAnnotationPayload,
  NormalizeResult,
  RawEventInput,
} from "@/lib/domain/types";

const EMPTY: NormalizeResult = { observations: [], timelineEvents: [] };

const MANUAL_EVENT_TYPE: Record<AnnotationType, TimelineEventType> = {
  meal: "meal",
  insulin: "insulin",
  travel: "travel",
  stress: "stress_event",
  note: "manual_note",
  exercise: "manual_note",
  sick: "manual_note",
  caffeine: "manual_note",
  alcohol: "manual_note",
  medication: "manual_note",
};

function normalizeManual(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as ManualAnnotationPayload;
  return {
    observations: [],
    timelineEvents: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "manual",
        eventType: MANUAL_EVENT_TYPE[p.type] ?? "manual_note",
        title: p.title,
        description: p.notes ?? null,
        startedAt: new Date(p.timestamp),
        endedAt: p.endTimestamp ? new Date(p.endTimestamp) : null,
        metadata: { annotationType: p.type, ...(p.metadata ?? {}) },
      },
    ],
  };
}

/** Map a raw source payload to normalized observations + timeline events.
 *  Pure: no DB, no IO. Unsupported source types yield an empty result. */
export function normalize(raw: RawEventInput): NormalizeResult {
  switch (raw.sourceType) {
    case "manual":
      return normalizeManual(raw);
    default:
      return EMPTY;
  }
}
```

- [ ] **Step 4: Run the test, verify it PASSES.** Run: `pnpm test lib/domain/normalize.test.ts`. Expected: PASS — 4 tests.

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/normalize.ts lib/domain/normalize.test.ts
git commit -m "feat: normalize manual annotations to timeline events"
```

---

## Task 5: Normalize the `dexcom` source (TDD)

**Files:**
- Modify: `lib/domain/normalize.ts`
- Modify: `lib/domain/normalize.test.ts`

- [ ] **Step 1: Add the failing dexcom tests.** Append to `lib/domain/normalize.test.ts` (after the manual `describe` block):

```ts
describe("normalize: dexcom", () => {
  const dbase = {
    id: "raw-2",
    userId: "user-1",
    sourceConnectionId: "conn-2",
    sourceRecordId: "reading-99",
    occurredAt: new Date("2026-06-01T12:00:00Z"),
    sourceType: "dexcom" as const,
  };

  it("maps a glucose reading to a glucose observation with attribution", () => {
    const raw: RawEventInput = {
      ...dbase,
      payload: { value: 7.1, unit: "mmol/L", timestamp: "2026-06-01T12:05:00Z", trend: "flat", trendRate: 0.1 },
    };
    const { observations, timelineEvents } = normalize(raw);
    expect(timelineEvents).toEqual([]);
    expect(observations).toHaveLength(1);
    const obs = observations[0];
    expect(obs.metric).toBe("glucose");
    expect(obs.sourceType).toBe("dexcom");
    expect(obs.rawEventId).toBe("raw-2");
    expect(obs.userId).toBe("user-1");
    expect(obs.value).toBe(7.1);
    expect(obs.unit).toBe("mmol/L");
    expect(obs.observedAt.toISOString()).toBe("2026-06-01T12:05:00.000Z");
    expect(obs.metadata).toEqual({ trend: "flat", trendRate: 0.1 });
  });

  it("omits trend fields from metadata when absent", () => {
    const raw: RawEventInput = {
      ...dbase,
      payload: { value: 5.5, unit: "mmol/L", timestamp: "2026-06-01T13:00:00Z" },
    };
    const obs = normalize(raw).observations[0];
    expect(obs.metadata).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test, verify the new dexcom tests FAIL.** Run: `pnpm test lib/domain/normalize.test.ts`. Expected: the manual tests still pass; the two dexcom tests FAIL (dexcom returns empty because the dispatcher has no `dexcom` case yet).

- [ ] **Step 3: Add the dexcom normalizer to `lib/domain/normalize.ts`.** Add the `DexcomReadingPayload` import, the `normalizeDexcom` function, and a `dexcom` case. The file becomes:

```ts
import type { AnnotationType, TimelineEventType } from "@/lib/db/schema";
import type {
  DexcomReadingPayload,
  ManualAnnotationPayload,
  NormalizeResult,
  RawEventInput,
} from "@/lib/domain/types";

const EMPTY: NormalizeResult = { observations: [], timelineEvents: [] };

const MANUAL_EVENT_TYPE: Record<AnnotationType, TimelineEventType> = {
  meal: "meal",
  insulin: "insulin",
  travel: "travel",
  stress: "stress_event",
  note: "manual_note",
  exercise: "manual_note",
  sick: "manual_note",
  caffeine: "manual_note",
  alcohol: "manual_note",
  medication: "manual_note",
};

function normalizeManual(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as ManualAnnotationPayload;
  return {
    observations: [],
    timelineEvents: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "manual",
        eventType: MANUAL_EVENT_TYPE[p.type] ?? "manual_note",
        title: p.title,
        description: p.notes ?? null,
        startedAt: new Date(p.timestamp),
        endedAt: p.endTimestamp ? new Date(p.endTimestamp) : null,
        metadata: { annotationType: p.type, ...(p.metadata ?? {}) },
      },
    ],
  };
}

function normalizeDexcom(raw: RawEventInput): NormalizeResult {
  const p = raw.payload as DexcomReadingPayload;
  return {
    observations: [
      {
        userId: raw.userId,
        rawEventId: raw.id,
        sourceType: "dexcom",
        metric: "glucose",
        value: p.value,
        unit: p.unit,
        observedAt: new Date(p.timestamp),
        metadata: {
          ...(p.trend !== undefined ? { trend: p.trend } : {}),
          ...(p.trendRate !== undefined ? { trendRate: p.trendRate } : {}),
        },
      },
    ],
    timelineEvents: [],
  };
}

/** Map a raw source payload to normalized observations + timeline events.
 *  Pure: no DB, no IO. Unsupported source types yield an empty result. */
export function normalize(raw: RawEventInput): NormalizeResult {
  switch (raw.sourceType) {
    case "manual":
      return normalizeManual(raw);
    case "dexcom":
      return normalizeDexcom(raw);
    default:
      return EMPTY;
  }
}
```

- [ ] **Step 4: Run the test, verify ALL pass.** Run: `pnpm test lib/domain/normalize.test.ts`. Expected: PASS — 6 tests (4 manual + 2 dexcom).

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/normalize.ts lib/domain/normalize.test.ts
git commit -m "feat: normalize dexcom glucose readings to observations"
```

---

## Task 6: Timeline ordering (TDD)

**Files:**
- Create: `lib/domain/ordering.ts`
- Test: `lib/domain/ordering.test.ts`

- [ ] **Step 1: Write the failing test.** Create `lib/domain/ordering.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { orderTimeline } from "@/lib/domain/ordering";

describe("orderTimeline", () => {
  it("sorts events chronologically by startedAt", () => {
    const events = [
      { startedAt: new Date("2026-06-01T12:00:00Z"), title: "b" },
      { startedAt: new Date("2026-06-01T08:00:00Z"), title: "a" },
      { startedAt: new Date("2026-06-01T20:00:00Z"), title: "c" },
    ];
    expect(orderTimeline(events).map((e) => e.title)).toEqual(["a", "b", "c"]);
  });

  it("is stable for equal timestamps (preserves input order)", () => {
    const t = new Date("2026-06-01T09:00:00Z");
    const events = [
      { startedAt: t, title: "first" },
      { startedAt: t, title: "second" },
    ];
    expect(orderTimeline(events).map((e) => e.title)).toEqual(["first", "second"]);
  });

  it("does not mutate the input array", () => {
    const events = [
      { startedAt: new Date("2026-06-01T12:00:00Z"), title: "b" },
      { startedAt: new Date("2026-06-01T08:00:00Z"), title: "a" },
    ];
    orderTimeline(events);
    expect(events.map((e) => e.title)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.** Run: `pnpm test lib/domain/ordering.test.ts`. Expected: FAIL — cannot resolve `@/lib/domain/ordering`.

- [ ] **Step 3: Implement `lib/domain/ordering.ts`:**

```ts
/** Order timeline items chronologically by start time. Returns a new array
 *  (does not mutate input). Array.prototype.sort is stable, so items with
 *  equal timestamps keep their input order. */
export function orderTimeline<T extends { startedAt: Date }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
```

- [ ] **Step 4: Run the test, verify it PASSES.** Run: `pnpm test lib/domain/ordering.test.ts`. Expected: PASS — 3 tests.

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/ordering.ts lib/domain/ordering.test.ts
git commit -m "feat: add stable timeline ordering"
```

---

## Task 7: Phase B verification gate

**Files:** none (verification only)

- [ ] **Step 1: Type-check.** Run: `pnpm exec tsc --noEmit`. Expected: no errors.
- [ ] **Step 2: Lint.** Run: `pnpm lint`. Expected: clean (warnings OK).
- [ ] **Step 3: Tests.** Run: `pnpm test`. Expected: all pass — the Phase A tests (cn, env = 6) plus the new domain tests (dedup 6 + normalize 6 + ordering 3 = 15) for 21 total.
- [ ] **Step 4: Build.** Run: `pnpm build`. Expected: success; routes `/`, `/today`, `/api/health` still present.
- [ ] **Step 5: Confirm migration is committed and tree clean.** Run: `git status -s` (expect empty) and `ls drizzle` (expect a `0000_*.sql` + `meta/`).

**Phase B complete when:** schema defines all 8 tables with idempotency indexes, the initial migration is generated + committed, the pure domain layer (`dedup`, `normalize` for manual + dexcom, `orderTimeline`) is implemented with all tests green, and tsc/lint/build pass.

---

## Self-Review

**Spec coverage (Phase B slice):**
- 8 core tables with build-requirements fields → Task 1. ✓
- raw_event idempotency: unique (connection, sourceRecordId) + fallback (connection, payloadHash) → Task 1 partial indexes; mirrored by `rawEventDedupeKey` → Task 3. ✓
- Normalized records carry source attribution + `rawEventId` back-ref → Task 3 types, Tasks 4–5 normalizers. ✓
- Migration generated → Task 2. ✓
- Required tests: normalization idempotency (dedup keys, Task 3), manual annotation mapping (Task 4), timeline ordering (Task 6). ✓ (Glucose/finance *snapshot* tests + cashflow normalize are later phases, per Scope.)
- Pure, DB-free domain so tests need no Postgres → Tasks 3–6 (no `@/lib/db` imports in domain). ✓

**Placeholder scan:** No TBD/vague steps; every code step has full code. JSON column types deliberately `Record<string, unknown>` with a comment pointing to the phase that refines them — documented decision, not a gap. ✓

**Type consistency:** `RawEventInput`, `NormalizeResult`, `NormalizedObservation`, `NormalizedTimelineEvent`, `ManualAnnotationPayload`, `DexcomReadingPayload` defined in `types.ts` (Task 3) and used unchanged in Tasks 4–5. `normalize`/`payloadHash`/`stableStringify`/`rawEventDedupeKey`/`orderTimeline` names match between impl and tests. Union types (`SourceType`, `AnnotationType`, `TimelineEventType`, `ObservationMetric`) defined in `schema.ts` (Task 1) and imported by domain. The Task-5 full-file rewrite of `normalize.ts` supersedes Task 4's version with identical manual logic (no drift). ✓

---

## Execution Handoff

Chosen after review: subagent-driven (per Phase A). Schema (Task 1) + migration (Task 2) are mechanical/config; Tasks 3–6 are authored TDD logic and get the fuller review. Final whole-branch review at Task 7.
