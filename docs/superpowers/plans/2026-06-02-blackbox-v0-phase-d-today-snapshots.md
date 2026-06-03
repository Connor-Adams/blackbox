# Blackbox v0 — Phase D: /today + Daily Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute deterministic daily summaries (glucose / finance / annotations) from the day's normalized data, persist them via the first Inngest job, and render the `/today` state-card screen.

**Architecture:** `computeDailySnapshot` is a pure function over a day's observations + timeline events — unit-tested with no DB. `/today` live-computes its cards from `getTimeline` + `computeDailySnapshot` (always fresh, no dependency on the job having run). Persistence is decoupled: an Inngest function (`daily-snapshot`) calls `computeAndStoreSnapshot` to upsert the `daily_snapshot` row, triggered by an event from `POST /api/jobs/daily-snapshot` or a daily cron — this persisted history feeds Phase E insights. Inngest is wired for the first time here (client + `/api/inngest` serve route).

**Tech Stack:** Inngest · Drizzle · Next.js App Router · Vitest. New dep: `inngest`.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) §Required screens (`/today`), §Jobs, §DailySnapshot. Builds on Phase C (`getTimeline`, schema, `dayRange`).

> Run from repo root. Branch: `claude/blackbox-phase-d` (off `main`). **Environment:** `pnpm add` blocked → edit `package.json` + `pnpm install`; no file deletions; run `pnpm test`/`build` in the subagent; **commit ONLY the files each task lists** (`git add <files>`, never `git add -A`) — an unrelated `components/timeline/AnnotationForm.tsx` modification is intentionally uncommitted in this worktree and must be left alone. No local DB — gate is DB-free; the Inngest job + persistence are verified against Railway (Task 6).

## Scope

In: `computeDailySnapshot` (glucose stats + TIR, finance from `transaction_amount`, annotation tally) + types; snapshot store (upsert/get) + `computeAndStoreSnapshot`; Inngest client + `daily-snapshot` function + `/api/inngest` serve + `POST /api/jobs/daily-snapshot`; `/today` page (replaces the Phase A stub) with state cards + date nav. **Out (later):** insights computation + the insights card content (Phase E — shown as an empty/"none yet" section here); finance data depends on the cashflow connector (Phase F), so the finance card reads "unknown" in v0; tz-aware days (UTC for now).

## File Structure (Phase D)

- `lib/domain/snapshot.ts` + `.test.ts` — `computeDailySnapshot` + `DailySnapshotSummary`.
- `lib/db/snapshots.ts` — `getDailySnapshot`, `computeAndStoreSnapshot`.
- `lib/inngest/client.ts`, `lib/inngest/functions.ts` — Inngest client + `daily-snapshot` function.
- `app/api/inngest/route.ts` — Inngest serve endpoint.
- `app/api/jobs/daily-snapshot/route.ts` — trigger route.
- `components/today/StateCard.tsx` — card primitive.
- `app/today/page.tsx` — **replace** the Phase A stub.
- `package.json` — add `inngest`.

---

## Task 1: `computeDailySnapshot` (pure, TDD)

**Files:** Create `lib/domain/snapshot.ts`, `lib/domain/snapshot.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `lib/domain/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDailySnapshot } from "@/lib/domain/snapshot";

const obs = (metric: string, value: number) => ({ metric, value });
const manual = (annotationType: string) => ({ sourceType: "manual", metadata: { annotationType } });

describe("computeDailySnapshot", () => {
  it("returns an empty summary for no data", () => {
    expect(computeDailySnapshot({ observations: [], timelineEvents: [] })).toEqual({});
  });

  it("computes glucose stats (count/avg/min/max/variability/TIR)", () => {
    const s = computeDailySnapshot({
      observations: [obs("glucose", 5), obs("glucose", 7), obs("glucose", 12), obs("glucose", 3)],
      timelineEvents: [],
    });
    expect(s.glucose).toBeDefined();
    expect(s.glucose!.readingCount).toBe(4);
    expect(s.glucose!.average).toBe(6.75);
    expect(s.glucose!.min).toBe(3);
    expect(s.glucose!.max).toBe(12);
    // population stddev of [5,7,12,3] ≈ 3.34
    expect(s.glucose!.variability).toBeCloseTo(3.34, 1);
    // in range 3.9–10: values 5 and 7 → 2/4 = 0.5
    expect(s.glucose!.estimatedTimeInRange).toBe(0.5);
  });

  it("ignores non-glucose observations for the glucose section", () => {
    const s = computeDailySnapshot({ observations: [obs("cash_balance", 100)], timelineEvents: [] });
    expect(s.glucose).toBeUndefined();
  });

  it("computes finance from transaction_amount observations", () => {
    const s = computeDailySnapshot({
      observations: [obs("transaction_amount", 12.5), obs("transaction_amount", 40)],
      timelineEvents: [],
    });
    expect(s.finance).toEqual({ spendTotal: 52.5, transactionCount: 2, largestTransaction: 40 });
  });

  it("tallies manual annotations by type", () => {
    const s = computeDailySnapshot({
      observations: [],
      timelineEvents: [manual("meal"), manual("meal"), manual("insulin"), { sourceType: "dexcom", metadata: {} }],
    });
    expect(s.annotations).toEqual({ count: 3, types: { meal: 2, insulin: 1 } });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/domain/snapshot.test.ts` → module missing.

- [ ] **Step 3: Implement `lib/domain/snapshot.ts`:**

```ts
export interface GlucoseSummary {
  readingCount: number;
  average: number;
  min: number;
  max: number;
  variability: number; // population standard deviation
  estimatedTimeInRange?: number; // fraction [0,1] within 3.9–10.0 mmol/L
}

export interface FinanceSummary {
  spendTotal: number;
  transactionCount: number;
  largestTransaction?: number;
}

export interface AnnotationsSummary {
  count: number;
  types: Record<string, number>;
}

export interface DailySnapshotSummary {
  glucose?: GlucoseSummary;
  finance?: FinanceSummary;
  annotations?: AnnotationsSummary;
}

export interface SnapshotInput {
  observations: { metric: string; value: number }[];
  timelineEvents: { sourceType: string; metadata: Record<string, unknown> }[];
}

const TIR_LOW = 3.9;
const TIR_HIGH = 10.0;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic daily rollup of a day's normalized data. Sections are present
 *  only when there is data for them. Pure: no DB, no IO. */
export function computeDailySnapshot(input: SnapshotInput): DailySnapshotSummary {
  const summary: DailySnapshotSummary = {};

  const glucose = input.observations.filter((o) => o.metric === "glucose").map((o) => o.value);
  if (glucose.length > 0) {
    const n = glucose.length;
    const average = glucose.reduce((a, b) => a + b, 0) / n;
    const variance = glucose.reduce((a, b) => a + (b - average) ** 2, 0) / n;
    const inRange = glucose.filter((v) => v >= TIR_LOW && v <= TIR_HIGH).length;
    summary.glucose = {
      readingCount: n,
      average: round(average),
      min: round(Math.min(...glucose)),
      max: round(Math.max(...glucose)),
      variability: round(Math.sqrt(variance)),
      estimatedTimeInRange: round(inRange / n, 3),
    };
  }

  const tx = input.observations.filter((o) => o.metric === "transaction_amount").map((o) => o.value);
  if (tx.length > 0) {
    summary.finance = {
      spendTotal: round(tx.reduce((a, b) => a + b, 0)),
      transactionCount: tx.length,
      largestTransaction: round(Math.max(...tx)),
    };
  }

  const manual = input.timelineEvents.filter((e) => e.sourceType === "manual");
  if (manual.length > 0) {
    const types: Record<string, number> = {};
    for (const e of manual) {
      const t = typeof e.metadata.annotationType === "string" ? e.metadata.annotationType : "unknown";
      types[t] = (types[t] ?? 0) + 1;
    }
    summary.annotations = { count: manual.length, types };
  }

  return summary;
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/domain/snapshot.test.ts` → 5 pass.

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/snapshot.ts lib/domain/snapshot.test.ts
git commit -m "feat: add deterministic daily snapshot computation"
```

---

## Task 2: Snapshot store + compute-and-store

**Files:** Create `lib/db/snapshots.ts`.

- [ ] **Step 1: Create `lib/db/snapshots.ts`:**

```ts
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dailySnapshot } from "@/lib/db/schema";
import { getTimeline } from "@/lib/db/store";
import { computeDailySnapshot, type DailySnapshotSummary } from "@/lib/domain/snapshot";

type Db = ReturnType<typeof getDb>;

export async function getDailySnapshot(userId: string, date: string, db: Db = getDb()) {
  const [row] = await db
    .select()
    .from(dailySnapshot)
    .where(and(eq(dailySnapshot.userId, userId), eq(dailySnapshot.date, date)))
    .limit(1);
  return row ?? null;
}

/** Compute the day's snapshot from normalized data and upsert it (idempotent on
 *  (userId, date)). Returns the computed summary. */
export async function computeAndStoreSnapshot(
  userId: string,
  date: string,
  db: Db = getDb(),
): Promise<DailySnapshotSummary> {
  const { events, observations } = await getTimeline(userId, date, db);
  const summary = computeDailySnapshot({
    observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
    timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
  });

  const existing = await getDailySnapshot(userId, date, db);
  if (existing) {
    await db
      .update(dailySnapshot)
      .set({ summaryJson: summary, timezone: "UTC", updatedAt: new Date() })
      .where(eq(dailySnapshot.id, existing.id));
  } else {
    await db.insert(dailySnapshot).values({ userId, date, timezone: "UTC", summaryJson: summary });
  }
  return summary;
}
```

- [ ] **Step 2: Type-check.** `pnpm exec tsc --noEmit` → clean. `summaryJson` column is typed `Record<string, unknown>`; `DailySnapshotSummary` is structurally assignable. If tsc rejects it, add `as Record<string, unknown>` on the `summaryJson` value (the shape is the source of truth). `getTimeline`'s third `db` param exists (Phase C1).

- [ ] **Step 3: Commit.**
```bash
git add lib/db/snapshots.ts
git commit -m "feat: add snapshot store and compute-and-store"
```

---

## Task 3: Inngest wiring + job trigger route

**Files:** Modify `package.json`; Create `lib/inngest/client.ts`, `lib/inngest/functions.ts`, `app/api/inngest/route.ts`, `app/api/jobs/daily-snapshot/route.ts`.

- [ ] **Step 1: Add `inngest`.** Edit `package.json` `dependencies`: add `"inngest": "^3.27.0"` (or latest 3.x), then `pnpm install`.

- [ ] **Step 2: Create `lib/inngest/client.ts`:**

```ts
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "blackbox" });

/** Event names this app emits. */
export type Events = {
  "snapshot/recompute.requested": { data: { date: string } };
};
```

- [ ] **Step 3: Create `lib/inngest/functions.ts`:**

```ts
import { inngest } from "./client";
import { computeAndStoreSnapshot } from "@/lib/db/snapshots";
import { SEED_USER_ID } from "@/lib/constants";

/** Recompute + persist a day's snapshot. Triggered on demand by the
 *  snapshot/recompute.requested event, and nightly by cron. Idempotent. */
export const dailySnapshot = inngest.createFunction(
  { id: "daily-snapshot" },
  [{ event: "snapshot/recompute.requested" }, { cron: "0 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const summary = await step.run("compute-and-store", () =>
      computeAndStoreSnapshot(SEED_USER_ID, date),
    );
    return { date, summary };
  },
);

export const functions = [dailySnapshot];
```

- [ ] **Step 4: Create `app/api/inngest/route.ts`:**

```ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
```

- [ ] **Step 5: Create `app/api/jobs/daily-snapshot/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  await inngest.send({ name: "snapshot/recompute.requested", data: { date } });
  return NextResponse.json({ ok: true, date }, { status: 202 });
}
```

- [ ] **Step 6: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; route list includes `/api/inngest` and `/api/jobs/daily-snapshot`. Build must succeed with no `DATABASE_URL` (the function body only runs at invocation, not at build; `inngest.send` is not called at build). If the Inngest function-trigger array type or `step.run` typing rejects, report the exact error and adjust minimally (e.g. drop the `cron` trigger to just the event, or inline without `step.run`) — keep the event trigger + `computeAndStoreSnapshot` call.

- [ ] **Step 7: Commit.**
```bash
git add package.json pnpm-lock.yaml lib/inngest/client.ts lib/inngest/functions.ts app/api/inngest/route.ts app/api/jobs/daily-snapshot/route.ts
git commit -m "feat: wire inngest with daily-snapshot job and trigger route"
```

---

## Task 4: `/today` screen (replace the stub)

**Files:** Create `components/today/StateCard.tsx`; Replace `app/today/page.tsx`.

- [ ] **Step 1: Create `components/today/StateCard.tsx`:**

```tsx
export function StateCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Replace `app/today/page.tsx`** entirely:

```tsx
import Link from "next/link";
import { getTimeline } from "@/lib/db/store";
import { computeDailySnapshot } from "@/lib/domain/snapshot";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { StateCard } from "@/components/today/StateCard";

export const dynamic = "force-dynamic";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function TodayPage({
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

  const { events, observations } = await getTimeline(SEED_USER_ID, date);
  const s = computeDailySnapshot({
    observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
    timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
  });

  const glucoseValue = s.glucose
    ? `${s.glucose.average} mmol/L`
    : "unknown";
  const glucoseSub = s.glucose
    ? `${s.glucose.readingCount} readings · ${s.glucose.min}–${s.glucose.max} · TIR ${Math.round((s.glucose.estimatedTimeInRange ?? 0) * 100)}%`
    : "no readings";

  const financeValue = s.finance ? `$${s.finance.spendTotal}` : "unknown";
  const financeSub = s.finance
    ? `${s.finance.transactionCount} transactions`
    : "no finance data yet";

  const annotationValue = s.annotations ? String(s.annotations.count) : "0";
  const annotationSub = s.annotations
    ? Object.entries(s.annotations.types).map(([t, n]) => `${t}×${n}`).join(" · ")
    : "no annotations";

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Today</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/today?date=${shiftDate(date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{date}</span>
          <Link href={`/today?date=${shiftDate(date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StateCard label="Glucose" value={glucoseValue} sub={glucoseSub} />
        <StateCard label="Finance" value={financeValue} sub={financeSub} />
        <StateCard label="Annotations" value={annotationValue} sub={annotationSub} />
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Top insights</div>
        <p className="mt-1 text-sm text-muted-foreground">No insights yet — coming in a later phase.</p>
      </section>

      <Link href={`/timeline?date=${date}`} className="inline-block text-sm underline underline-offset-4">
        View full timeline →
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; `/today` is dynamic; build works with no `DATABASE_URL`.

- [ ] **Step 4: Commit.**
```bash
git add components/today/StateCard.tsx app/today/page.tsx
git commit -m "feat: build /today state-card screen from daily snapshot"
```

---

## Task 5: Phase D verification gate (automated)

**Files:** none.

- [ ] **Step 1: tsc.** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2: lint.** `pnpm lint` → clean.
- [ ] **Step 3: tests.** `pnpm test` → all prior (44) + snapshot (5) = 49 pass.
- [ ] **Step 4: build.** `pnpm build` → success; routes include `/today`, `/api/inngest`, `/api/jobs/daily-snapshot`, plus all prior; build works with no `DATABASE_URL`.
- [ ] **Step 5: tree.** `git status -s` → only the intentionally-uncommitted `components/timeline/AnnotationForm.tsx` should remain (everything from this phase committed). Do NOT commit AnnotationForm.tsx.

---

## Task 6: Manual verification against Railway (documented; run by Connor)

- [ ] `pnpm db:migrate` (no schema change this phase, but confirms migration state), `pnpm db:seed` if not already seeded.
- [ ] `pnpm dev` + `npx inngest-cli@latest dev` (Inngest dev server pointed at `http://localhost:3000/api/inngest`).
- [ ] Open `/today?date=2026-06-01`: expect a Glucose card (avg/min–max/TIR from the seeded normal+volatile readings), an Annotations card (meal×2, insulin×1, etc.), Finance "unknown", an empty insights section, and a link to the timeline.
- [ ] `curl -X POST 'http://localhost:3000/api/jobs/daily-snapshot?date=2026-06-01'` → 202; the Inngest dev dashboard shows the `daily-snapshot` run; a `daily_snapshot` row is upserted. Re-run → no duplicate row (idempotent on (userId, date)).

**Phase D complete when:** the automated gate (Task 5) is green and the Task 6 run shows `/today` rendering the seeded summary + the snapshot job persisting idempotently.

---

## Self-Review

**Spec coverage:** `/today` selected date + glucose/finance/annotations state cards + top-insights section + timeline link → Task 4 ✓; DailySnapshot computed fields (glucose count/avg/min/max/variability/TIR; finance spendTotal/txCount/largest; annotations count/types) → Task 1 ✓; daily snapshot job, idempotent, event + cron triggered → Tasks 2–3 ✓; `POST /api/jobs/daily-snapshot` → Task 3 ✓; Inngest as the job runtime → Task 3 ✓. Insights card content + finance data are correctly deferred (Phases E / F) and surfaced as "none yet" / "unknown" per the state-vector model.

**Placeholder scan:** full code in every step; the inngest version, the `summaryJson` cast fallback, and the Railway/Inngest-dev run are explicit instructions, not gaps. No TODO/TBD. ✓

**Type consistency:** `DailySnapshotSummary`/`SnapshotInput` defined in `snapshot.ts` (Task 1), used by `snapshots.ts` (Task 2) + `/today` (Task 4). `computeAndStoreSnapshot` (Task 2) used by the Inngest function (Task 3). `getTimeline(userId, date, db?)`, `dayRange`, `SEED_USER_ID`, `dailySnapshot` table referenced with correct names. `inngest` client shared by functions + both routes. ✓

---

## Execution Handoff

Subagent-driven. Pure TDD (Task 1) + the phase get fresh-eyes review at the Task 5 gate. DB/Inngest code (Tasks 2–3) and `/today` (Task 4) are tsc/build-verified here and functionally confirmed by the Task 6 Railway + Inngest-dev run. After the gate, Phase D ships as one PR (push + `gh pr create`/merge are agent-policy-blocked — hand the PR step to Connor as in Phase C).
