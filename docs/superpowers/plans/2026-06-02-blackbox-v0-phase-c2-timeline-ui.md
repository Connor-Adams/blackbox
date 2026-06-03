# Blackbox v0 — Phase C2: Timeline UI + API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the timeline vertical — a `/timeline` page (date nav, chronological events with source badges, glucose strip, source filter, event detail) plus the `GET /api/timeline` and `POST /api/annotations` routes, where creating an annotation flows through the real ingest pipeline onto the timeline.

**Architecture:** A server component (`app/timeline/page.tsx`) reads the seeded data via the Phase C1 store (`getTimeline`), serializes it through a pure DTO mapper, and hands it to a client `TimelineView` for interactivity (date nav, source filter, event detail, annotation form). `POST /api/annotations` writes an `annotation` row and ingests a manual payload (carrying the annotation id as its source record id) through `ingestRawEvents`, so the new entry appears on the timeline via the same raw→normalize→persist path as Dexcom. Pure DTO + input-validation logic is unit-tested; the page/components and DB-touching routes are tsc/build-verified and confirmed manually against a Railway Postgres.

**Tech Stack:** Next.js App Router (server + client components) · Recharts · zod · Drizzle · Vitest.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) §Required screens (`/timeline`), §API. Builds on Phase C1 (`getTimeline`, `DbIngestStore`, `ingestRawEvents`, mock seed).

> Run all commands from repo root. Branch: `claude/blackbox-phase-c` (C1 already committed here). **Environment:** `pnpm add` blocked → add deps by editing `package.json` + `pnpm install`; no file deletions; run `pnpm test`/`build` in the subagent. **No local DB** — automated gate is DB-free; the rendered timeline is verified against Railway (Task 8).

## Scope

In: manual-annotation `recordId` linkage; pure timeline DTO + annotation input validation; `GET /api/timeline`, `POST /api/annotations`; `/timeline` page + client view (date nav, event list + source badges, Recharts glucose strip, source filter, event detail panel, annotation form). **Out (later phases):** `/today`, `/insights`, `/sources` screens; `GET /api/observations` standalone route (glucose is included in the timeline payload); snapshots/insights; tz-aware dates. Visual polish is minimal-but-clean, not final design.

## File Structure (Phase C2)

- `lib/domain/types.ts`, `lib/domain/ingest.ts` — **modify**: optional `recordId` on manual payload + extraction.
- `lib/api/timeline-dto.ts` + `.test.ts` — pure `serializeTimeline`.
- `lib/api/annotation-input.ts` + `.test.ts` — pure `parseAnnotationInput` (zod).
- `lib/db/store.ts` — **modify**: add shared `ensureSourceConnection`; `scripts/seed.ts` refactored to use it.
- `lib/db/annotations.ts` — `createAnnotation` (writes annotation row + ingests manual payload).
- `app/api/timeline/route.ts`, `app/api/annotations/route.ts` — routes.
- `app/timeline/page.tsx` — server page.
- `components/timeline/TimelineView.tsx`, `GlucoseStrip.tsx`, `EventList.tsx`, `AnnotationForm.tsx` — UI.
- `package.json` — add `recharts`.

---

## Task 1: Manual annotation `recordId` linkage (TDD)

So an annotation's id can become its raw event's `sourceRecordId` (idempotent + links annotation→timeline event).

**Files:** Modify `lib/domain/types.ts`, `lib/domain/ingest.ts`, `lib/domain/ingest.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `lib/domain/ingest.test.ts`:

```ts
describe("extractRawMeta: manual recordId", () => {
  it("uses the manual payload recordId as the source record id when present", () => {
    const meta = extractRawMeta("manual", { type: "note", title: "x", timestamp: "2026-06-01T09:00:00Z", recordId: "ann-1" });
    expect(meta.sourceRecordId).toBe("ann-1");
  });
  it("stays null when the manual payload has no recordId", () => {
    const meta = extractRawMeta("manual", { type: "note", title: "x", timestamp: "2026-06-01T09:00:00Z" });
    expect(meta.sourceRecordId).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/domain/ingest.test.ts` → the new `recordId present` test fails (currently manual always returns null).

- [ ] **Step 3: Add `recordId` to `ManualAnnotationPayload`** in `lib/domain/types.ts` (add the optional field):

```ts
export interface ManualAnnotationPayload {
  type:
    | "note" | "meal" | "insulin" | "exercise" | "sick"
    | "travel" | "stress" | "caffeine" | "alcohol" | "medication";
  title: string;
  timestamp: string;
  endTimestamp?: string;
  notes?: string;
  recordId?: string;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: Update the `manual` case in `extractRawMeta`** (`lib/domain/ingest.ts`) to read it:

```ts
    case "manual": {
      const p = payload as ManualAnnotationPayload;
      return { sourceRecordId: p.recordId ?? null, occurredAt: new Date(p.timestamp) };
    }
```

- [ ] **Step 5: Run, verify PASS.** `pnpm test lib/domain/ingest.test.ts` → all pass (10 now). Also `pnpm test lib/domain/normalize.test.ts` still passes (normalize ignores recordId).

- [ ] **Step 6: Commit.**
```bash
git add lib/domain/types.ts lib/domain/ingest.ts lib/domain/ingest.test.ts
git commit -m "feat: support recordId on manual payloads for annotation linkage"
```

---

## Task 2: Pure timeline DTO + annotation input validation (TDD)

**Files:** Create `lib/api/timeline-dto.ts` (+ test), `lib/api/annotation-input.ts` (+ test).

- [ ] **Step 1: Failing test** `lib/api/timeline-dto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeTimeline } from "@/lib/api/timeline-dto";

const ev = (over: Partial<Record<string, unknown>>) => ({
  id: "e", userId: "u", rawEventId: "r", sourceType: "manual", eventType: "manual_note",
  title: "t", description: null, startedAt: new Date("2026-06-01T10:00:00Z"), endedAt: null, metadata: {}, ...over,
});
const obs = (over: Partial<Record<string, unknown>>) => ({
  id: "o", userId: "u", rawEventId: "r", sourceType: "dexcom", metric: "glucose",
  value: 5, unit: "mmol/L", observedAt: new Date("2026-06-01T10:00:00Z"), metadata: {}, ...over,
});

describe("serializeTimeline", () => {
  it("orders events chronologically and serializes dates to ISO", () => {
    const dto = serializeTimeline("2026-06-01", {
      events: [ev({ id: "late", startedAt: new Date("2026-06-01T18:00:00Z") }), ev({ id: "early", startedAt: new Date("2026-06-01T06:00:00Z") })],
      observations: [],
    });
    expect(dto.events.map((e) => e.id)).toEqual(["early", "late"]);
    expect(dto.events[0].startedAt).toBe("2026-06-01T06:00:00.000Z");
    expect(dto.date).toBe("2026-06-01");
  });

  it("keeps only glucose observations, sorted, as {observedAt,value,unit}", () => {
    const dto = serializeTimeline("2026-06-01", {
      events: [],
      observations: [
        obs({ metric: "glucose", value: 7, observedAt: new Date("2026-06-01T12:00:00Z") }),
        obs({ metric: "cash_balance", value: 100 }),
        obs({ metric: "glucose", value: 5, observedAt: new Date("2026-06-01T08:00:00Z") }),
      ],
    });
    expect(dto.glucose.map((g) => g.value)).toEqual([5, 7]);
    expect(dto.glucose[0]).toEqual({ observedAt: "2026-06-01T08:00:00.000Z", value: 5, unit: "mmol/L" });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/api/timeline-dto.test.ts`.

- [ ] **Step 3: Implement `lib/api/timeline-dto.ts`:**

```ts
import { orderTimeline } from "@/lib/domain/ordering";
import type { observation, timelineEvent } from "@/lib/db/schema";

type EventRow = typeof timelineEvent.$inferSelect;
type ObservationRow = typeof observation.$inferSelect;

export interface TimelineEventDTO {
  id: string;
  sourceType: string;
  eventType: string;
  title: string;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  metadata: Record<string, unknown>;
}
export interface GlucosePointDTO {
  observedAt: string;
  value: number;
  unit: string;
}
export interface TimelineDTO {
  date: string;
  events: TimelineEventDTO[];
  glucose: GlucosePointDTO[];
}

/** Pure mapping of DB rows → the timeline payload the UI consumes. */
export function serializeTimeline(
  date: string,
  data: { events: EventRow[]; observations: ObservationRow[] },
): TimelineDTO {
  const events = orderTimeline(data.events).map((e) => ({
    id: e.id,
    sourceType: e.sourceType,
    eventType: e.eventType,
    title: e.title,
    description: e.description ?? null,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    metadata: e.metadata ?? {},
  }));
  const glucose = data.observations
    .filter((o) => o.metric === "glucose")
    .map((o) => ({ observedAt: o.observedAt.toISOString(), value: o.value, unit: o.unit }))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return { date, events, glucose };
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/api/timeline-dto.test.ts` → 2 pass.

- [ ] **Step 5: Failing test** `lib/api/annotation-input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAnnotationInput } from "@/lib/api/annotation-input";

describe("parseAnnotationInput", () => {
  it("accepts a valid annotation", () => {
    const a = parseAnnotationInput({ type: "meal", title: "Lunch", timestamp: "2026-06-01T12:00:00Z", notes: "x" });
    expect(a.type).toBe("meal");
    expect(a.title).toBe("Lunch");
  });
  it("rejects an unknown type", () => {
    expect(() => parseAnnotationInput({ type: "party", title: "x", timestamp: "2026-06-01T12:00:00Z" })).toThrow();
  });
  it("rejects an empty title", () => {
    expect(() => parseAnnotationInput({ type: "note", title: "", timestamp: "2026-06-01T12:00:00Z" })).toThrow();
  });
  it("rejects a bad timestamp", () => {
    expect(() => parseAnnotationInput({ type: "note", title: "x", timestamp: "nope" })).toThrow();
  });
});
```

- [ ] **Step 6: Run, verify FAIL.** `pnpm test lib/api/annotation-input.test.ts`.

- [ ] **Step 7: Implement `lib/api/annotation-input.ts`:**

```ts
import { z } from "zod";
import { annotationTypes } from "@/lib/db/schema";

const isoTimestamp = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid timestamp");

export const annotationInputSchema = z.object({
  type: z.enum(annotationTypes),
  title: z.string().min(1),
  timestamp: isoTimestamp,
  endTimestamp: isoTimestamp.optional(),
  notes: z.string().optional(),
});

export type AnnotationInput = z.infer<typeof annotationInputSchema>;

export function parseAnnotationInput(body: unknown): AnnotationInput {
  return annotationInputSchema.parse(body);
}
```

- [ ] **Step 8: Run, verify PASS.** `pnpm test lib/api/annotation-input.test.ts` → 4 pass.

- [ ] **Step 9: Commit.**
```bash
git add lib/api/timeline-dto.ts lib/api/timeline-dto.test.ts lib/api/annotation-input.ts lib/api/annotation-input.test.ts
git commit -m "feat: add timeline DTO serializer and annotation input validation"
```

---

## Task 3: Shared `ensureSourceConnection` + annotation create

**Files:** Modify `lib/db/store.ts`, `scripts/seed.ts`; Create `lib/db/annotations.ts`.

- [ ] **Step 1: Add `ensureSourceConnection` to `lib/db/store.ts`** (append; reuses the `Db`, `getDb`, `sourceConnection` already imported — add `sourceConnection` to the schema import and `SourceType` type import if missing):

```ts
import { sourceConnection } from "@/lib/db/schema";
import type { SourceType } from "@/lib/db/schema";
import { SEED_USER_ID } from "@/lib/constants";

/** Insert a source connection with a fixed id if it does not already exist
 *  (idempotent). Returns the IngestConnection shape. */
export async function ensureSourceConnection(
  input: { id: string; sourceType: SourceType; displayName: string },
  db: Db = getDb(),
): Promise<{ id: string; userId: string; sourceType: SourceType }> {
  const [existing] = await db
    .select({ id: sourceConnection.id })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, input.id))
    .limit(1);
  if (!existing) {
    await db.insert(sourceConnection).values({
      id: input.id,
      userId: SEED_USER_ID,
      sourceType: input.sourceType,
      displayName: input.displayName,
      status: "active",
    });
  }
  return { id: input.id, userId: SEED_USER_ID, sourceType: input.sourceType };
}
```
> Merge the new imports into the existing import lines in `store.ts` (no duplicate imports). `eq` and `getDb` are already imported there.

- [ ] **Step 2: Refactor `scripts/seed.ts`** to use the shared helper — replace its local `ensureConnection` function and its calls with `ensureSourceConnection` imported from `@/lib/db/store`:

```ts
import { getDb } from "@/lib/db/client";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import {
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";

async function main() {
  void getDb(); // fail fast if DATABASE_URL is missing
  const store = new DbIngestStore();

  const dexcom = await ensureSourceConnection({ id: SEED_DEXCOM_CONNECTION_ID, sourceType: "dexcom", displayName: "Dexcom (mock)" });
  const manual = await ensureSourceConnection({ id: SEED_MANUAL_CONNECTION_ID, sourceType: "manual", displayName: "Manual log" });

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

- [ ] **Step 3: Create `lib/db/annotations.ts`** — writes the annotation row, then ingests it as a manual event so it lands on the timeline:

```ts
import { getDb } from "@/lib/db/client";
import { annotation } from "@/lib/db/schema";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import type { AnnotationInput } from "@/lib/api/annotation-input";
import type { ManualAnnotationPayload } from "@/lib/domain/types";
import { SEED_MANUAL_CONNECTION_ID } from "@/lib/constants";

/** Persist a manual annotation: write the annotation row, then run it through
 *  the ingest pipeline (manual source) so a timeline event is created. The
 *  annotation id is the raw event's source record id (idempotent + links them). */
export async function createAnnotation(input: AnnotationInput): Promise<{ id: string }> {
  const db = getDb();
  const conn = await ensureSourceConnection({
    id: SEED_MANUAL_CONNECTION_ID,
    sourceType: "manual",
    displayName: "Manual log",
  });

  const [row] = await db
    .insert(annotation)
    .values({
      userId: conn.userId,
      type: input.type,
      title: input.title,
      startedAt: new Date(input.timestamp),
      endedAt: input.endTimestamp ? new Date(input.endTimestamp) : null,
      notes: input.notes ?? null,
    })
    .returning({ id: annotation.id });

  const payload: ManualAnnotationPayload = {
    type: input.type,
    title: input.title,
    timestamp: input.timestamp,
    endTimestamp: input.endTimestamp,
    notes: input.notes,
    recordId: row.id,
  };
  await ingestRawEvents(new DbIngestStore(db), conn, [payload]);

  return { id: row.id };
}
```

- [ ] **Step 4: Type-check.** `pnpm exec tsc --noEmit` → clean. (Do not run the seed.)

- [ ] **Step 5: Commit.**
```bash
git add lib/db/store.ts scripts/seed.ts lib/db/annotations.ts
git commit -m "feat: shared ensureSourceConnection and annotation create via ingest"
```

---

## Task 4: API routes

**Files:** Create `app/api/timeline/route.ts`, `app/api/annotations/route.ts`.

- [ ] **Step 1: Create `app/api/timeline/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getTimeline } from "@/lib/db/store";
import { serializeTimeline } from "@/lib/api/timeline-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "2026-06-01";
  try {
    dayRange(date); // validates YYYY-MM-DD, throws otherwise
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const data = await getTimeline(SEED_USER_ID, date);
  return NextResponse.json(serializeTimeline(date, data));
}
```

- [ ] **Step 2: Create `app/api/annotations/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseAnnotationInput } from "@/lib/api/annotation-input";
import { createAnnotation } from "@/lib/db/annotations";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let input;
  try {
    input = parseAnnotationInput(body);
  } catch (error) {
    const message = error instanceof ZodError ? error.issues : String(error);
    return NextResponse.json({ error: "validation failed", detail: message }, { status: 400 });
  }
  const created = await createAnnotation(input);
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; route list now includes `/api/timeline` and `/api/annotations` (both dynamic). The build must succeed WITHOUT `DATABASE_URL` (routes are dynamic + the db client is lazy, so no DB access at build time).

- [ ] **Step 4: Commit.**
```bash
git add app/api/timeline/route.ts app/api/annotations/route.ts
git commit -m "feat: add timeline and annotations API routes"
```

---

## Task 5: Add Recharts + glucose strip + event list components

**Files:** Modify `package.json`; Create `components/timeline/GlucoseStrip.tsx`, `components/timeline/EventList.tsx`.

- [ ] **Step 1: Add `recharts`.** Edit `package.json` `dependencies` to add `"recharts": "^2.15.0"` (or latest 2.x), then run `pnpm install`. (Not `pnpm add` — it is blocked.)

- [ ] **Step 2: Create `components/timeline/GlucoseStrip.tsx`** (client; Recharts line of glucose points):

```tsx
"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GlucosePointDTO } from "@/lib/api/timeline-dto";

export function GlucoseStrip({ glucose }: { glucose: GlucosePointDTO[] }) {
  if (glucose.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        No glucose readings for this day.
      </div>
    );
  }
  const data = glucose.map((g) => ({
    time: new Date(g.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: g.value,
  }));
  const unit = glucose[0]?.unit ?? "";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Glucose ({unit})</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} width={32} domain={["dataMin - 1", "dataMax + 1"]} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/timeline/EventList.tsx`** (client; chronological list with source badges + click-to-select):

```tsx
"use client";

import type { TimelineEventDTO } from "@/lib/api/timeline-dto";

export function EventList({
  events,
  onSelect,
}: {
  events: TimelineEventDTO[];
  onSelect: (event: TimelineEventDTO) => void;
}) {
  if (events.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No events for this day. Add one below.</div>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {events.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect(e)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
          >
            <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
              {new Date(e.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {e.sourceType}
            </span>
            <span className="flex-1 truncate text-sm">{e.title}</span>
            <span className="text-xs text-muted-foreground">{e.eventType}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean (components compile; not yet rendered anywhere — that's Task 6/7).

- [ ] **Step 5: Commit.**
```bash
git add package.json pnpm-lock.yaml components/timeline/GlucoseStrip.tsx components/timeline/EventList.tsx
git commit -m "feat: add recharts glucose strip and event list components"
```

---

## Task 6: Annotation form + timeline view (client) + page (server)

**Files:** Create `components/timeline/AnnotationForm.tsx`, `components/timeline/TimelineView.tsx`, `app/timeline/page.tsx`.

- [ ] **Step 1: Create `components/timeline/AnnotationForm.tsx`** (client; posts then refreshes):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { annotationTypes } from "@/lib/db/schema";

export function AnnotationForm({ date }: { date: string }) {
  const router = useRouter();
  const [type, setType] = useState<string>("note");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("12:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const timestamp = new Date(`${date}T${time}:00Z`).toISOString();
    const res = await fetch("/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, title, timestamp, notes: notes || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not save annotation.");
      return;
    }
    setTitle("");
    setNotes("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Add annotation</div>
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          {annotationTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input value={time} onChange={(e) => setTime(e.target.value)} type="time" className="rounded border border-border bg-background px-2 py-1 text-sm" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm" />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded border border-border bg-background px-2 py-1 text-sm" />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <Button type="submit" disabled={busy || !title}>{busy ? "Saving…" : "Add"}</Button>
    </form>
  );
}
```

- [ ] **Step 2: Create `components/timeline/TimelineView.tsx`** (client; owns date nav, source filter, selection):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { TimelineDTO, TimelineEventDTO } from "@/lib/api/timeline-dto";
import { GlucoseStrip } from "./GlucoseStrip";
import { EventList } from "./EventList";
import { AnnotationForm } from "./AnnotationForm";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TimelineView({ timeline }: { timeline: TimelineDTO }) {
  const sources = Array.from(new Set(timeline.events.map((e) => e.sourceType)));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TimelineEventDTO | null>(null);

  const events = timeline.events.filter((e) => !hidden.has(e.sourceType));

  function toggle(src: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/timeline?date=${shiftDate(timeline.date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{timeline.date}</span>
          <Link href={`/timeline?date=${shiftDate(timeline.date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      <GlucoseStrip glucose={timeline.glucose} />

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {sources.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => toggle(src)}
              className={`rounded border px-2 py-1 ${hidden.has(src) ? "border-border text-muted-foreground line-through" : "border-foreground"}`}
            >
              {src}
            </button>
          ))}
        </div>
      )}

      <EventList events={events} onSelect={setSelected} />

      {selected && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{selected.title}</span>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:underline">close</button>
          </div>
          <div className="text-xs text-muted-foreground">
            {selected.sourceType} · {selected.eventType} · {new Date(selected.startedAt).toLocaleString()}
          </div>
          {selected.description && <p className="mt-1">{selected.description}</p>}
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(selected.metadata, null, 2)}</pre>
        </div>
      )}

      <AnnotationForm date={timeline.date} />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/timeline/page.tsx`** (server component):

```tsx
import { getTimeline } from "@/lib/db/store";
import { serializeTimeline } from "@/lib/api/timeline-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { TimelineView } from "@/components/timeline/TimelineView";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  let date = rawDate ?? "2026-06-01";
  try {
    dayRange(date);
  } catch {
    date = "2026-06-01";
  }
  const data = await getTimeline(SEED_USER_ID, date);
  const timeline = serializeTimeline(date, data);
  return <TimelineView timeline={timeline} />;
}
```
> Next 16 passes `searchParams` as a Promise — it is awaited above. If your Next minor types `searchParams` as a plain object, drop the `Promise<>` wrapper and the `await`. Resolve to whichever the installed types require so `tsc` and `build` pass.

- [ ] **Step 4: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; route list includes `/timeline` (dynamic). Build succeeds without `DATABASE_URL` (page is `force-dynamic`; the lazy db client is only hit at request time).

- [ ] **Step 5: Commit.**
```bash
git add components/timeline/AnnotationForm.tsx components/timeline/TimelineView.tsx app/timeline/page.tsx
git commit -m "feat: add /timeline page with date nav, filter, detail, annotation form"
```

---

## Task 7: Phase C2 verification gate (automated)

**Files:** none.

- [ ] **Step 1: tsc.** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2: lint.** `pnpm lint` → clean.
- [ ] **Step 3: tests.** `pnpm test` → all pass: C1 set (36) + manual recordId (2) + timeline-dto (2) + annotation-input (4) = 44.
- [ ] **Step 4: build.** `pnpm build` → success; routes include `/timeline`, `/api/timeline`, `/api/annotations` (all dynamic), plus the prior `/`, `/today`, `/api/health`. Must build with no `DATABASE_URL` set.
- [ ] **Step 5: tree clean.** `git status -s` → empty.

---

## Task 8: Manual verification against Railway (documented; run by Connor)

Not part of the automated gate — this is how the rendered vertical is confirmed, since there is no local DB.

- [ ] Set `DATABASE_URL` in `.env.local` to a Railway Postgres connection string.
- [ ] Apply schema: `pnpm db:migrate`.
- [ ] Seed: `pnpm db:seed` (idempotent; safe to re-run).
- [ ] `pnpm dev`, open `http://localhost:3000/timeline?date=2026-06-01`. Expect: a glucose strip (normal + volatile readings), the manual events (meal/insulin/exercise/stress) and any others, source-filter chips toggling manual/dexcom, clicking an event showing its detail/metadata, and adding an annotation (it appears after submit via `router.refresh()`).
- [ ] Re-run `pnpm db:seed`; confirm no duplicate events appear (idempotency).

**Phase C2 complete when:** the automated gate (Task 7) is green and the Task 8 manual pass shows the seeded timeline rendering + annotation creation working against Railway.

---

## Self-Review

**Spec coverage (§/timeline):** date nav (Task 6 TimelineView `shiftDate` + links) ✓; chronological events (serializeTimeline orders via `orderTimeline`) ✓; glucose strip when readings exist (GlucoseStrip, empty-state otherwise) ✓; source badges + filter (EventList badge + TimelineView toggle) ✓; event detail (TimelineView selected panel incl. metadata) ✓; manual annotation creation (AnnotationForm → POST → createAnnotation → ingest → timeline) ✓. §API: `GET /api/timeline?date=`, `POST /api/annotations` ✓ (standalone `/api/observations` deferred — glucose is in the timeline payload; noted in Scope).

**Placeholder scan:** complete code in every step. The `searchParams` Promise note and the recharts/`DATABASE_URL` caveats are explicit instructions, not gaps. No TODO/TBD. ✓

**Type consistency:** `TimelineDTO`/`TimelineEventDTO`/`GlucosePointDTO` defined in `timeline-dto.ts` (Task 2), consumed by GlucoseStrip/EventList/TimelineView/page (Tasks 5–6) and the timeline route (Task 4). `AnnotationInput` (Task 2) used by `createAnnotation` (Task 3) + the annotations route (Task 4). `ensureSourceConnection` (Task 3) used by seed + annotations. `ManualAnnotationPayload.recordId` (Task 1) consumed by `createAnnotation` (Task 3) and `extractRawMeta` (Task 1). `getTimeline`/`serializeTimeline`/`SEED_USER_ID`/`dayRange`/`annotationTypes` referenced with correct names. ✓

---

## Execution Handoff

Subagent-driven. Pure TDD tasks (1–2) + the C2 changes get fresh-eyes review at the Task 7 gate. DB-touching code (Tasks 3–4) and UI (Tasks 5–6) are tsc/build-verified here and functionally confirmed by the Task 8 Railway run. After the gate, Phase C (C1+C2) ships as one PR.
