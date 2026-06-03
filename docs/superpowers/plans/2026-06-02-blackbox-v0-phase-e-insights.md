# Blackbox v0 — Phase E: Deterministic Insights + /insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate deterministic, inspectable insights from a day's normalized data (rule-based, no LLM), persist them (idempotent, dismissals survive recompute), and render the `/insights` explorer with evidence drilldown, filters, and dismiss.

**Architecture:** `computeInsights` is a pure function producing `ComputedInsight[]` from a day's observations + timeline events via fixed-threshold rules — unit-tested, no DB. Each insight carries its evidence (`sourceObservationIds`, `evidence` JSON) so findings are inspectable, per the product's "no unexplained summaries" rule. Insights are persisted (so they can be dismissed); the store upserts by `(userId, date, insightType)` and **preserves an existing `status`** so recompute never un-dismisses. An Inngest `insights` job recomputes on event/cron; `/insights` lazily computes-and-stores if a day has none, then reads.

**Tech Stack:** Drizzle · Inngest · Next.js App Router · Vitest.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) §Required screens (`/insights`), §Insight, §Deterministic insights first. Builds on C (`getTimeline`, dayRange) + D (Inngest wiring, store patterns).

> Run from repo root. Branch: `claude/blackbox-phase-e` (off `main`). **Environment:** `pnpm add` blocked → edit `package.json` + `pnpm install` (none needed this phase); no file deletions; run `pnpm test`/`build` in the subagent; **stage only the files each task lists** (`git add <files>`, never `-A`) — an unrelated formatting-only `components/timeline/AnnotationForm.tsx` change is intentionally uncommitted in this worktree; leave it. No local DB — gate is DB-free; `/insights` + the job are verified on Railway (Task 6).

## Scope

In: `computeInsights` (glucose volatility / high / low / spike-without-context, finance high-spend / high-tx-count) + types; insights store (upsert-preserving-status, get, dismiss) + `computeAndStoreInsights`; Inngest `insights` job + `POST /api/jobs/insights`; `GET /api/insights` + dismiss route; `/insights` page (list, severity/type filter, evidence drilldown, dismiss). **Out (later):** historical/personal baselines (v0 uses fixed thresholds — documented); cross-day correlation; finance insights only fire once the cashflow connector lands (Phase F); source-based filtering (insights span sources — type+severity filter only).

## File Structure (Phase E)

- `lib/domain/insights.ts` + `.test.ts` — `computeInsights` + `ComputedInsight`.
- `lib/db/insights.ts` — `getInsights`, `upsertInsight`, `dismissInsight`, `computeAndStoreInsights`.
- `lib/inngest/functions.ts` — **modify**: add the `insights` function to the registered `functions` array.
- `app/api/jobs/insights/route.ts` — trigger route.
- `app/api/insights/route.ts` — `GET` list.
- `app/api/insights/dismiss/route.ts` — `POST` dismiss.
- `lib/api/insight-dto.ts` + `.test.ts` — pure `serializeInsights`.
- `app/insights/page.tsx`, `components/insights/InsightsView.tsx` — UI.

---

## Task 1: `computeInsights` (pure, TDD)

**Files:** Create `lib/domain/insights.ts`, `lib/domain/insights.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `lib/domain/insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeInsights } from "@/lib/domain/insights";

const g = (id: string, value: number, iso: string) => ({ id, metric: "glucose", value, observedAt: new Date(iso) });
const ev = (id: string, eventType: string, iso: string) => ({ id, sourceType: "manual", eventType, startedAt: new Date(iso), metadata: {} });

function types(input: Parameters<typeof computeInsights>[0]) {
  return computeInsights(input).map((i) => i.insightType).sort();
}

describe("computeInsights", () => {
  it("returns nothing for a calm in-range day", () => {
    const observations = [g("a", 5.2, "2026-06-01T06:00:00Z"), g("b", 6.1, "2026-06-01T08:00:00Z"), g("c", 5.8, "2026-06-01T10:00:00Z")];
    expect(computeInsights({ observations, timelineEvents: [] })).toEqual([]);
  });

  it("flags volatility, a high, and a low on a swingy day", () => {
    const observations = [
      g("a", 4.0, "2026-06-01T06:00:00Z"),
      g("b", 13.5, "2026-06-01T09:00:00Z"),
      g("c", 3.2, "2026-06-01T14:00:00Z"),
    ];
    expect(types({ observations, timelineEvents: [] })).toEqual(["glucose_high", "glucose_low", "glucose_volatility", "spike_without_context"]);
  });

  it("suppresses spike_without_context when a meal/insulin is within 90 minutes", () => {
    const observations = [g("a", 5, "2026-06-01T06:00:00Z"), g("b", 13.5, "2026-06-01T09:00:00Z"), g("c", 6, "2026-06-01T10:00:00Z")];
    const timelineEvents = [ev("m", "insulin", "2026-06-01T08:30:00Z")]; // 30 min before the spike
    const t = types({ observations, timelineEvents });
    expect(t).toContain("glucose_high");
    expect(t).not.toContain("spike_without_context");
  });

  it("a high glucose insight references the offending reading ids and evidence", () => {
    const observations = [g("a", 5, "2026-06-01T06:00:00Z"), g("hi", 14, "2026-06-01T09:00:00Z")];
    const high = computeInsights({ observations, timelineEvents: [] }).find((i) => i.insightType === "glucose_high")!;
    expect(high.sourceObservationIds).toEqual(["hi"]);
    expect(high.severity).toBe("warning");
    expect(high.evidence.max).toBe(14);
  });

  it("flags a high-spend day from transaction_amount observations", () => {
    const observations = [
      { id: "t1", metric: "transaction_amount", value: 150, observedAt: new Date("2026-06-01T10:00:00Z") },
      { id: "t2", metric: "transaction_amount", value: 120, observedAt: new Date("2026-06-01T12:00:00Z") },
    ];
    const t = types({ observations, timelineEvents: [] });
    expect(t).toContain("high_spend");
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/domain/insights.test.ts`.

- [ ] **Step 3: Implement `lib/domain/insights.ts`:**

```ts
import type { InsightSeverity } from "@/lib/db/schema";

export interface ComputedInsight {
  insightType: string;
  severity: InsightSeverity;
  title: string;
  summary: string;
  sourceObservationIds: string[];
  sourceTimelineEventIds: string[];
  evidence: Record<string, unknown>;
}

export interface InsightObservation {
  id: string;
  metric: string;
  value: number;
  observedAt: Date;
}
export interface InsightEvent {
  id: string;
  sourceType: string;
  eventType: string;
  startedAt: Date;
  metadata: Record<string, unknown>;
}
export interface InsightInput {
  observations: InsightObservation[];
  timelineEvents: InsightEvent[];
}

// v0 fixed thresholds (personal/historical baselines come later).
const VOLATILITY = 3.0; // mmol/L population stddev
const HIGH = 13.0;
const LOW = 3.9;
const CONTEXT_WINDOW_MS = 90 * 60 * 1000;
const HIGH_SPEND = 200;
const HIGH_TX_COUNT = 20;

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Deterministic, inspectable insight rules over one day's normalized data.
 *  Pure: no DB, no IO. At most one insight per insightType (so persistence can
 *  upsert on (userId, date, insightType)). */
export function computeInsights(input: InsightInput): ComputedInsight[] {
  const out: ComputedInsight[] = [];
  const glucose = input.observations.filter((o) => o.metric === "glucose");

  if (glucose.length >= 2) {
    const vals = glucose.map((g) => g.value);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (stddev > VOLATILITY) {
      out.push({
        insightType: "glucose_volatility",
        severity: "warning",
        title: "Volatile glucose day",
        summary: `Glucose variability (${round(stddev)} mmol/L) exceeded the ${VOLATILITY} threshold.`,
        sourceObservationIds: glucose.map((g) => g.id),
        sourceTimelineEventIds: [],
        evidence: { stddev: round(stddev), threshold: VOLATILITY },
      });
    }
  }

  const highs = glucose.filter((g) => g.value > HIGH);
  if (highs.length > 0) {
    const max = Math.max(...highs.map((g) => g.value));
    out.push({
      insightType: "glucose_high",
      severity: "warning",
      title: "Glucose spike",
      summary: `${highs.length} reading(s) above ${HIGH} mmol/L (max ${round(max)}).`,
      sourceObservationIds: highs.map((g) => g.id),
      sourceTimelineEventIds: [],
      evidence: { count: highs.length, max: round(max), threshold: HIGH },
    });
  }

  const lows = glucose.filter((g) => g.value < LOW);
  if (lows.length > 0) {
    const min = Math.min(...lows.map((g) => g.value));
    out.push({
      insightType: "glucose_low",
      severity: "critical",
      title: "Low glucose",
      summary: `${lows.length} reading(s) below ${LOW} mmol/L (min ${round(min)}).`,
      sourceObservationIds: lows.map((g) => g.id),
      sourceTimelineEventIds: [],
      evidence: { count: lows.length, min: round(min), threshold: LOW },
    });
  }

  const context = input.timelineEvents.filter((e) => e.eventType === "meal" || e.eventType === "insulin");
  const uncovered = highs.filter(
    (spike) => !context.some((e) => Math.abs(e.startedAt.getTime() - spike.observedAt.getTime()) <= CONTEXT_WINDOW_MS),
  );
  if (uncovered.length > 0) {
    out.push({
      insightType: "spike_without_context",
      severity: "notice",
      title: "Spike(s) without logged context",
      summary: `${uncovered.length} glucose spike(s) had no meal or insulin logged within 90 minutes.`,
      sourceObservationIds: uncovered.map((g) => g.id),
      sourceTimelineEventIds: [],
      evidence: { count: uncovered.length },
    });
  }

  const tx = input.observations.filter((o) => o.metric === "transaction_amount");
  if (tx.length > 0) {
    const total = tx.reduce((a, b) => a + b.value, 0);
    if (total > HIGH_SPEND) {
      out.push({
        insightType: "high_spend",
        severity: "notice",
        title: "High spend day",
        summary: `Spending totalled $${round(total)}, above the $${HIGH_SPEND} threshold.`,
        sourceObservationIds: tx.map((t) => t.id),
        sourceTimelineEventIds: [],
        evidence: { total: round(total), threshold: HIGH_SPEND },
      });
    }
    if (tx.length > HIGH_TX_COUNT) {
      out.push({
        insightType: "high_tx_count",
        severity: "info",
        title: "Many transactions",
        summary: `${tx.length} transactions, above the ${HIGH_TX_COUNT} threshold.`,
        sourceObservationIds: tx.map((t) => t.id),
        sourceTimelineEventIds: [],
        evidence: { count: tx.length, threshold: HIGH_TX_COUNT },
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/domain/insights.test.ts` → 5 pass. (The swingy-day test expects all four glucose insight types: the 13.5 spike at 09:00 has no meal/insulin near it in that test, so `spike_without_context` fires.)

- [ ] **Step 5: Commit.**
```bash
git add lib/domain/insights.ts lib/domain/insights.test.ts
git commit -m "feat: add deterministic insight rules"
```

---

## Task 2: Insights store + compute-and-store

**Files:** Create `lib/db/insights.ts`.

- [ ] **Step 1: Create `lib/db/insights.ts`:**

```ts
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { insight } from "@/lib/db/schema";
import { getTimeline } from "@/lib/db/store";
import { dayRange } from "@/lib/domain/time";
import { computeInsights } from "@/lib/domain/insights";
import type { InsightSeverity } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

export async function getInsights(userId: string, date: string, db: Db = getDb()) {
  return db
    .select()
    .from(insight)
    .where(and(eq(insight.userId, userId), eq(insight.date, date)));
}

export async function dismissInsight(id: string, db: Db = getDb()): Promise<void> {
  await db.update(insight).set({ status: "dismissed" }).where(eq(insight.id, id));
}

/** Recompute the day's insights and upsert on (userId, date, insightType).
 *  Updates content of existing rows but PRESERVES their status, so a recompute
 *  never un-dismisses a dismissed insight. Idempotent. */
export async function computeAndStoreInsights(userId: string, date: string, db: Db = getDb()) {
  const { start, end } = dayRange(date);
  const { events, observations } = await getTimeline(userId, date, db);
  const computed = computeInsights({
    observations: observations.map((o) => ({ id: o.id, metric: o.metric, value: o.value, observedAt: o.observedAt })),
    timelineEvents: events.map((e) => ({ id: e.id, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata })),
  });

  for (const c of computed) {
    const [existing] = await db
      .select({ id: insight.id })
      .from(insight)
      .where(and(eq(insight.userId, userId), eq(insight.date, date), eq(insight.insightType, c.insightType)))
      .limit(1);

    const content = {
      severity: c.severity as InsightSeverity,
      title: c.title,
      summary: c.summary,
      evidenceJson: c.evidence as Record<string, unknown>,
      sourceObservationIds: c.sourceObservationIds,
      sourceTimelineEventIds: c.sourceTimelineEventIds,
      timeRangeStart: start,
      timeRangeEnd: end,
    };

    if (existing) {
      await db.update(insight).set(content).where(eq(insight.id, existing.id)); // status preserved
    } else {
      await db.insert(insight).values({
        userId,
        date,
        insightType: c.insightType,
        status: "active",
        ...content,
      });
    }
  }
  return computed.length;
}
```

- [ ] **Step 2: Type-check.** `pnpm exec tsc --noEmit` → clean. (`getTimeline` returns rows with `id`, `metric`, `value`, `observedAt`, `eventType`, `startedAt`, `metadata` — all used above. `evidenceJson`/`sourceObservationIds` json columns accept the casts.) Report any cast needed.

- [ ] **Step 3: Commit.**
```bash
git add lib/db/insights.ts
git commit -m "feat: add insights store with dismiss-preserving recompute"
```

---

## Task 3: Inngest insights job + trigger route

**Files:** Modify `lib/inngest/functions.ts`; Create `app/api/jobs/insights/route.ts`.

- [ ] **Step 1: Add the `insights` function in `lib/inngest/functions.ts`.** Add the import + function and include it in the exported `functions` array (full file):

```ts
import { inngest } from "./client";
import { computeAndStoreSnapshot } from "@/lib/db/snapshots";
import { computeAndStoreInsights } from "@/lib/db/insights";
import { SEED_USER_ID } from "@/lib/constants";

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

export const insights = inngest.createFunction(
  { id: "insights" },
  [{ event: "insights/recompute.requested" }, { cron: "15 1 * * *" }],
  async ({ event, step }) => {
    const date =
      (event?.data as { date?: string } | undefined)?.date ??
      new Date().toISOString().slice(0, 10);
    const count = await step.run("compute-and-store", () =>
      computeAndStoreInsights(SEED_USER_ID, date),
    );
    return { date, count };
  },
);

export const functions = [dailySnapshot, insights];
```

- [ ] **Step 2: Create `app/api/jobs/insights/route.ts`:**

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
  await inngest.send({ name: "insights/recompute.requested", data: { date } });
  return NextResponse.json({ ok: true, date }, { status: 202 });
}
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build`. Expected: clean; `/api/jobs/insights` in the route list; `/api/inngest` still serves (now 2 functions). Build works without `DATABASE_URL`.

- [ ] **Step 4: Commit.**
```bash
git add lib/inngest/functions.ts app/api/jobs/insights/route.ts
git commit -m "feat: add insights inngest job and trigger route"
```

---

## Task 4: Insights API (list + dismiss) + DTO (TDD for DTO)

**Files:** Create `lib/api/insight-dto.ts` (+ test), `app/api/insights/route.ts`, `app/api/insights/dismiss/route.ts`.

- [ ] **Step 1: Failing DTO test** `lib/api/insight-dto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeInsights } from "@/lib/api/insight-dto";

const row = (over: Partial<Record<string, unknown>>) => ({
  id: "i1", userId: "u", date: "2026-06-01", timeRangeStart: new Date("2026-06-01T00:00:00Z"),
  timeRangeEnd: new Date("2026-06-02T00:00:00Z"), insightType: "glucose_high", severity: "warning",
  title: "Glucose spike", summary: "…", evidenceJson: { max: 14 }, sourceObservationIds: ["o1"],
  sourceTimelineEventIds: [], status: "active", createdAt: new Date("2026-06-01T01:00:00Z"), ...over,
});

describe("serializeInsights", () => {
  it("drops dismissed/archived and orders by severity (critical first)", () => {
    const out = serializeInsights([
      row({ id: "warn", severity: "warning" }),
      row({ id: "crit", severity: "critical" }),
      row({ id: "gone", status: "dismissed" }),
      row({ id: "info", severity: "info" }),
    ] as never);
    expect(out.map((i) => i.id)).toEqual(["crit", "warn", "info"]);
  });

  it("serializes evidence + source ids", () => {
    const [i] = serializeInsights([row({})] as never);
    expect(i.evidence).toEqual({ max: 14 });
    expect(i.sourceObservationIds).toEqual(["o1"]);
    expect(i.severity).toBe("warning");
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm test lib/api/insight-dto.test.ts`.

- [ ] **Step 3: Implement `lib/api/insight-dto.ts`:**

```ts
import type { insight } from "@/lib/db/schema";

type InsightRow = typeof insight.$inferSelect;

export interface InsightDTO {
  id: string;
  insightType: string;
  severity: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  sourceObservationIds: string[];
  sourceTimelineEventIds: string[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, notice: 2, info: 3 };

/** Active insights only, ordered by severity (critical first). Pure. */
export function serializeInsights(rows: InsightRow[]): InsightDTO[] {
  return rows
    .filter((r) => r.status === "active")
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .map((r) => ({
      id: r.id,
      insightType: r.insightType,
      severity: r.severity,
      title: r.title,
      summary: r.summary,
      evidence: r.evidenceJson ?? {},
      sourceObservationIds: r.sourceObservationIds ?? [],
      sourceTimelineEventIds: r.sourceTimelineEventIds ?? [],
    }));
}
```

- [ ] **Step 4: Run, verify PASS.** `pnpm test lib/api/insight-dto.test.ts` → 2 pass.

- [ ] **Step 5: Create `app/api/insights/route.ts`** (GET — lazily computes if the day has none, then returns active insights):

```ts
import { NextResponse } from "next/server";
import { getInsights, computeAndStoreInsights } from "@/lib/db/insights";
import { serializeInsights } from "@/lib/api/insight-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "2026-06-01";
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  let rows = await getInsights(SEED_USER_ID, date);
  if (rows.length === 0) {
    await computeAndStoreInsights(SEED_USER_ID, date);
    rows = await getInsights(SEED_USER_ID, date);
  }
  return NextResponse.json({ date, insights: serializeInsights(rows) });
}
```

- [ ] **Step 6: Create `app/api/insights/dismiss/route.ts`** (POST `?id=`):

```ts
import { NextResponse } from "next/server";
import { dismissInsight } from "@/lib/db/insights";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  await dismissInsight(id);
  return NextResponse.json({ ok: true, id });
}
```

- [ ] **Step 7: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build` → clean; routes `/api/insights`, `/api/insights/dismiss` present; build works without `DATABASE_URL`.

- [ ] **Step 8: Commit.**
```bash
git add lib/api/insight-dto.ts lib/api/insight-dto.test.ts app/api/insights/route.ts app/api/insights/dismiss/route.ts
git commit -m "feat: add insights list + dismiss API and DTO"
```

---

## Task 5: `/insights` screen

**Files:** Create `components/insights/InsightsView.tsx`, `app/insights/page.tsx`.

- [ ] **Step 1: Create `components/insights/InsightsView.tsx`** (client — severity filter, evidence drilldown, dismiss):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InsightDTO } from "@/lib/api/insight-dto";

const SEVERITIES = ["critical", "warning", "notice", "info"] as const;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InsightsView({ date, insights }: { date: string; insights: InsightDTO[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const present = Array.from(new Set(insights.map((i) => i.severity)));
  const shown = insights.filter((i) => !hidden.has(i.severity));

  async function dismiss(id: string) {
    setBusy(id);
    await fetch(`/api/insights/dismiss?id=${id}`, { method: "POST" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
        <nav className="flex items-center gap-2 text-sm">
          <Link href={`/insights?date=${shiftDate(date, -1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">←</Link>
          <span className="tabular-nums">{date}</span>
          <Link href={`/insights?date=${shiftDate(date, 1)}`} className="rounded border border-border px-2 py-1 hover:bg-muted">→</Link>
        </nav>
      </header>

      {present.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {SEVERITIES.filter((s) => present.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setHidden((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; })}
              className={`rounded border px-2 py-1 ${hidden.has(s) ? "border-border text-muted-foreground line-through" : "border-foreground"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No active insights for this day.</div>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{i.severity}</span>
                    <span className="text-sm font-medium">{i.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>
                </div>
                <button type="button" onClick={() => dismiss(i.id)} disabled={busy === i.id} className="shrink-0 text-xs text-muted-foreground hover:underline">
                  {busy === i.id ? "…" : "dismiss"}
                </button>
              </div>
              <button type="button" onClick={() => setOpen((p) => { const n = new Set(p); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })} className="mt-2 text-xs underline underline-offset-4">
                {open.has(i.id) ? "hide evidence" : "evidence"}
              </button>
              {open.has(i.id) && (
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify({ evidence: i.evidence, observations: i.sourceObservationIds, events: i.sourceTimelineEventIds }, null, 2)}</pre>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link href={`/today?date=${date}`} className="inline-block text-sm underline underline-offset-4">← Back to today</Link>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/insights/page.tsx`** (server — lazily computes if empty, then serializes):

```tsx
import { getInsights, computeAndStoreInsights } from "@/lib/db/insights";
import { serializeInsights } from "@/lib/api/insight-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { InsightsView } from "@/components/insights/InsightsView";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
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

  let rows = await getInsights(SEED_USER_ID, date);
  if (rows.length === 0) {
    await computeAndStoreInsights(SEED_USER_ID, date);
    rows = await getInsights(SEED_USER_ID, date);
  }
  return <InsightsView date={date} insights={serializeInsights(rows)} />;
}
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build` → clean; `/insights` dynamic; build works without `DATABASE_URL`. No `@/lib/db/*` import in a `"use client"` file (InsightsView imports only the `InsightDTO` type — type import is erased; fine).

- [ ] **Step 4: Commit.**
```bash
git add components/insights/InsightsView.tsx app/insights/page.tsx
git commit -m "feat: build /insights explorer with filters, evidence, dismiss"
```

---

## Task 6: Phase E verification gate (automated)

**Files:** none.

- [ ] **Step 1: tsc.** `pnpm exec tsc --noEmit` → no errors.
- [ ] **Step 2: lint.** `pnpm lint` → clean.
- [ ] **Step 3: tests.** `pnpm test` → prior (49) + insights (5) + insight-dto (2) = 56 pass.
- [ ] **Step 4: build.** `pnpm build` → success; routes include `/insights`, `/api/insights`, `/api/insights/dismiss`, `/api/jobs/insights`, plus all prior; build works without `DATABASE_URL`.
- [ ] **Step 5: tree.** `git status -s` → only the intentionally-uncommitted `components/timeline/AnnotationForm.tsx`; everything from this phase committed.

---

## Task 7: Manual verification against Railway (documented; run by Connor)

- [ ] `pnpm db:seed` (if needed), `pnpm dev` + `inngest-cli dev`.
- [ ] Open `/insights?date=2026-06-01`: expect insights from the seeded volatile glucose day (volatility / high / low at minimum), severity filter chips, an evidence drilldown showing `sourceObservationIds` + the rule's evidence, and a working dismiss (the dismissed insight disappears and stays gone on `router.refresh()`).
- [ ] `curl -X POST 'http://localhost:3000/api/jobs/insights?date=2026-06-01'` → 202; Inngest dev shows the `insights` run; rows upsert. Dismiss one, re-run the job → the dismissed insight stays dismissed (status preserved). The `/today` insights section can be wired to these in a later polish pass.

> Note: v0 thresholds are fixed (not personal baselines), so the seeded day yields ~3 glucose insights — the build-requirements "≥5 mock insights" target will be met once finance (cashflow) data + more seed days land; the engine itself is complete.

**Phase E complete when:** the automated gate (Task 6) is green and the Task 7 run shows `/insights` rendering rule-based insights with evidence + dismiss persisting across recompute.

---

## Self-Review

**Spec coverage:** deterministic (non-LLM) rules with evidence → Task 1 ✓ (each insight carries `sourceObservationIds` + `evidence`); insight persistence, idempotent, dismiss-preserving → Task 2 ✓; insights job + `POST /api/jobs/insights` → Task 3 ✓; `/insights` list + type/severity filter + evidence inspect + dismiss → Tasks 4–5 ✓ (`GET /api/insights`, dismiss route). Personal baselines + source filter + the "≥5" mock target are explicitly deferred with rationale.

**Placeholder scan:** full code in every step; the threshold-vs-baseline note and Railway run are explicit, not gaps. No TODO/TBD. ✓

**Type consistency:** `ComputedInsight`/`InsightInput` (Task 1) used by the store (Task 2) + the Inngest function (Task 3). `InsightDTO`/`serializeInsights` (Task 4) used by the API (Task 4) + `/insights` (Task 5). `getInsights`/`computeAndStoreInsights`/`dismissInsight` (Task 2) used by routes + page. `insight` table, `InsightSeverity`, `dayRange`, `getTimeline`, `SEED_USER_ID`, `inngest` referenced with correct names. The `insights` Inngest function is added to the existing `functions` array (Task 3 shows the full file, preserving `dailySnapshot`). ✓

---

## Execution Handoff

Subagent-driven. Pure TDD (Tasks 1, 4-DTO) + the phase get fresh-eyes review at the Task 6 gate. DB/Inngest/UI (Tasks 2–3, 5) are tsc/build-verified here and functionally confirmed by the Task 7 Railway + Inngest-dev run. After the gate: push; `gh pr create`/merge are agent-policy-blocked — hand the PR to Connor (push succeeds; provide the compare URL).
