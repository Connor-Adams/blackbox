# Blackbox v0 — Phase G: Polish + Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The final v0 pass — cross-screen navigation, setup docs (README + `.env.example`), a deterministic ≥5-insights acceptance test against the seed, and a documented v0 acceptance checklist.

**Architecture:** Small, integrative changes on top of the complete A–F app. A shared `Nav` in the root layout links the four screens. The seed gains one uncovered glucose spike so the seeded day deterministically yields ≥5 insights (build-requirements' mock target), proven by a pure pipeline test (mock payloads → `normalize` → `computeInsights`). README documents the local + Railway setup; `.env.example` gains the Inngest keys. A `docs/v0-acceptance.md` maps each acceptance criterion to how it's verified.

**Tech Stack:** Next.js App Router · Vitest. No new deps.

**Spec:** [design](../specs/2026-06-02-blackbox-v0-design.md) · [build-requirements](../../build-requirements.md) §Acceptance criteria for v0, §Seed/mock data, §Environment.

> Run from repo root. Branch: `claude/blackbox-phase-g` (off `main`, has A–F). **Environment:** `pnpm add` blocked (none needed); no file deletions; run `pnpm test`/`build` in the subagent; **stage only the files each task lists** — an unrelated formatting-only `components/timeline/AnnotationForm.tsx` change is intentionally uncommitted; leave it. If a build complains about stale `.next` (a prior branch's artifacts), `mv .next /tmp/bb-next-stale-g` (mv is allowed) and rebuild.

## Scope

In: shared `Nav` + layout wiring; one uncovered glucose spike in the seed + a pipeline acceptance test for ≥5 insights; README "Development" + deploy section; `.env.example` Inngest keys; `docs/v0-acceptance.md`. **Out (documented post-v0 follow-ups, NOT implemented here — non-blocking for single-user v0):** snapshot/insight upserts → `ON CONFLICT DO UPDATE` (the insight one needs a `(userId,date,insightType)` unique index migration); personal-baseline insight thresholds; real OAuth/HTTP connectors; tz-aware days.

## File Structure (Phase G)

- `components/Nav.tsx` — shared nav.
- `app/layout.tsx` — **modify**: render `<Nav />`; set lang metadata already done in Phase A.
- `lib/mock/data.ts` + `data.test.ts` — **modify**: add the uncovered spike.
- `lib/domain/insights.acceptance.test.ts` — pipeline ≥5 test.
- `README.md` — **modify**: Development + Deploy sections.
- `.env.example` — **modify**: Inngest keys.
- `docs/v0-acceptance.md` — acceptance checklist.

---

## Task 1: Shared navigation

**Files:** Create `components/Nav.tsx`; Modify `app/layout.tsx`.

- [ ] **Step 1: Create `components/Nav.tsx`:**

```tsx
import Link from "next/link";

const LINKS: [string, string][] = [
  ["/today", "Today"],
  ["/timeline", "Timeline"],
  ["/insights", "Insights"],
  ["/sources", "Sources"],
];

export function Nav() {
  return (
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3 text-sm">
        <Link href="/today" className="font-semibold tracking-tight">Blackbox</Link>
        <div className="flex gap-3 text-muted-foreground">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-foreground">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Render `<Nav />` in `app/layout.tsx`.** Read the current file; add `import { Nav } from "@/components/Nav";` and render `<Nav />` as the first child inside `<body ...>`, immediately before `{children}`. Leave the existing `metadata`, fonts, and `<html>/<body>` structure intact. Example body:
```tsx
      <body className={/* keep existing className */}>
        <Nav />
        {children}
      </body>
```

- [ ] **Step 3: Type-check + build.** `pnpm exec tsc --noEmit` then `pnpm build` → clean; build works without `DATABASE_URL`. (Visit any screen → the nav bar links to all four.)

- [ ] **Step 4: Commit.**
```bash
git add components/Nav.tsx app/layout.tsx
git commit -m "feat: add shared nav across today/timeline/insights/sources"
```

---

## Task 2: ≥5 seeded insights (mock tweak + acceptance test)

**Files:** Modify `lib/mock/data.ts`, `lib/mock/data.test.ts`; Create `lib/domain/insights.acceptance.test.ts`.

The seeded day currently yields 4 insight types (volatility, high, low, high_spend); the one high reading (13.5 @ 09:00) is "covered" by the 07:35 insulin, so `spike_without_context` doesn't fire. Add a high reading with no meal/insulin within 90 minutes → `spike_without_context` fires → 5 types.

- [ ] **Step 1: Add an uncovered spike to `glucoseVolatileDay` in `lib/mock/data.ts`.** Append this reading to the `glucoseVolatileDay` array (17:00 has no meal/insulin within 90 min — the seeded manual events are exercise 12:30–13:00, stress 15:00, meal 21:00):
```ts
  { value: 14.0, unit: "mmol/L", timestamp: `${D}T17:00:00Z`, recordId: "vol-7", trend: "rising" },
```

- [ ] **Step 2: Update the volatile-day assertion in `lib/mock/data.test.ts`** if it pins a length/range — the existing test only checks the range is wider than normal, which still holds (14.0 widens it further). Run `pnpm test lib/mock/data.test.ts` to confirm it still passes; adjust only if a hard-coded count breaks.

- [ ] **Step 3: Create the pipeline acceptance test `lib/domain/insights.acceptance.test.ts`** — runs the real seed payloads through `normalize` → `computeInsights` and asserts ≥5 distinct insight types:

```ts
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/domain/normalize";
import { computeInsights, type InsightObservation, type InsightEvent } from "@/lib/domain/insights";
import type { RawEventInput } from "@/lib/domain/types";
import type { SourceType } from "@/lib/db/schema";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay, cashflowDay } from "@/lib/mock/data";

function raw(idx: number, sourceType: SourceType, payload: unknown): RawEventInput {
  return {
    id: `raw-${idx}`,
    userId: "user-1",
    sourceConnectionId: "conn",
    sourceType,
    sourceRecordId: null,
    occurredAt: new Date("2026-06-01T00:00:00Z"),
    payload,
  };
}

describe("v0 acceptance: seeded day yields >= 5 insights", () => {
  it("normalizes the full seed and computes at least 5 distinct insight types", () => {
    const inputs: RawEventInput[] = [
      ...glucoseNormalDay.map((p, i) => raw(i, "dexcom", p)),
      ...glucoseVolatileDay.map((p, i) => raw(100 + i, "dexcom", p)),
      ...manualNotesDay.map((p, i) => raw(200 + i, "manual", p)),
      ...cashflowDay.map((p, i) => raw(300 + i, "cashflow", p)),
    ];

    const observations: InsightObservation[] = [];
    const timelineEvents: InsightEvent[] = [];
    for (const input of inputs) {
      const n = normalize(input);
      n.observations.forEach((o, j) =>
        observations.push({ id: `${input.id}-o${j}`, metric: o.metric, value: o.value, observedAt: o.observedAt }),
      );
      n.timelineEvents.forEach((e, j) =>
        timelineEvents.push({ id: `${input.id}-e${j}`, sourceType: e.sourceType, eventType: e.eventType, startedAt: e.startedAt, metadata: e.metadata }),
      );
    }

    const types = new Set(computeInsights({ observations, timelineEvents }).map((i) => i.insightType));
    expect(types.size).toBeGreaterThanOrEqual(5);
    // the expected mix from the seed:
    for (const t of ["glucose_volatility", "glucose_high", "glucose_low", "spike_without_context", "high_spend"]) {
      expect(types.has(t)).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run.** `pnpm test lib/domain/insights.acceptance.test.ts` → PASS (≥5 types, all 5 expected present). If `spike_without_context` is missing, the 14:00–17:00 spike is being covered — re-check the seeded manual event times; do not weaken the assertion.

- [ ] **Step 5: Commit.**
```bash
git add lib/mock/data.ts lib/mock/data.test.ts lib/domain/insights.acceptance.test.ts
git commit -m "feat: seed an uncovered spike so the day yields >=5 insights + acceptance test"
```

---

## Task 3: README setup + `.env.example` completeness

**Files:** Modify `README.md`, `.env.example`.

- [ ] **Step 1: Add Inngest keys to `.env.example`** (append after the Dexcom block):
```bash
# Inngest (jobs). Optional locally with the inngest-cli dev server; required in cloud.
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

- [ ] **Step 2: Append a Development + Deploy section to `README.md`** (after the existing content):

```markdown
## Development

Prerequisites: Node 20+, pnpm, and a Postgres database (Railway, or any Postgres).

```bash
pnpm install
cp .env.example .env.local        # then set DATABASE_URL (Railway Postgres URL)
pnpm db:migrate                   # apply the schema
pnpm db:seed                      # seed mock data (idempotent)
pnpm dev                          # http://localhost:3000
npx inngest-cli@latest dev        # (optional) drives the snapshot/insights jobs
```

Screens: `/today` (daily state), `/timeline` (events + glucose), `/insights` (rule-based findings), `/sources` (connections + sync).

Scripts: `pnpm test` (Vitest, DB-free), `pnpm lint`, `pnpm build`, `pnpm db:generate` (author a migration), `pnpm db:studio`.

## Deploy (Railway)

1. Create a Railway project with a Postgres plugin; point the web service at this repo.
2. Set env vars: `DATABASE_URL` (Railway provides it), `BLACKBOX_APP_URL`, and any connector/Inngest keys.
3. `railway.json` runs `pnpm db:migrate` as the pre-deploy command and `pnpm start` to serve.
4. After first deploy, run `pnpm db:seed` against the Railway database to load mock data.
```

- [ ] **Step 3: Verify.** Run `grep -c INNGEST .env.example` (expect 2) and confirm `.env.example` still lists `DATABASE_URL`, `BLACKBOX_APP_URL`, `CASHFLOW_*`, `DEXCOM_*`. Confirm `git check-ignore .env.example` outputs nothing (still tracked).

- [ ] **Step 4: Commit.**
```bash
git add README.md .env.example
git commit -m "docs: document development + Railway deploy setup; add inngest env keys"
```

---

## Task 4: v0 acceptance checklist + final gate

**Files:** Create `docs/v0-acceptance.md`.

- [ ] **Step 1: Create `docs/v0-acceptance.md`** mapping build-requirements' v0 acceptance criteria to how each is verified:

```markdown
# Blackbox v0 — Acceptance

Maps [build-requirements.md](build-requirements.md) §"Acceptance criteria for v0" to how each is met.

| Criterion | Status | Verified by |
|---|---|---|
| App runs locally from a fresh clone | ✅ | `pnpm install && pnpm dev` (README) |
| Database migrations apply cleanly | ✅ | `pnpm db:migrate` (Railway / dev DB) |
| Mock data can be seeded | ✅ | `pnpm db:seed` (idempotent; manual + dexcom + cashflow) |
| `/today` shows a useful daily summary | ✅ | live-computed glucose/finance/annotation cards |
| `/timeline` shows manual events, transactions, and glucose together | ✅ | `/timeline` event list + glucose strip + source filter |
| Manual annotations can be created | ✅ | annotation form → `POST /api/annotations` → timeline |
| Source records preserve raw imported payloads | ✅ | `raw_event.payload` (jsonb), normalization reads from it |
| Daily snapshots can be computed | ✅ | `computeDailySnapshot` + `daily-snapshot` Inngest job |
| Insights can be computed and inspected | ✅ | `computeInsights` + `/insights` evidence drilldown |
| Source attribution is visible | ✅ | source badges on timeline; `sourceType`/`rawEventId` on every record |
| Repeated import/snapshot/insight jobs are idempotent | ✅ | dedupe keys + upserts (unit-tested) |
| README explains setup | ✅ | README Development + Deploy |
| ≥5 generated mock insights | ✅ | `insights.acceptance.test.ts` (5 types from the seed) |

## Known post-v0 follow-ups (non-blocking)
- Snapshot/insight upserts use select-then-insert; swap to `ON CONFLICT DO UPDATE` before concurrent job retries (insight needs a `(userId,date,insightType)` unique-index migration).
- Personal/historical baselines for insight thresholds (v0 uses fixed thresholds).
- Real OAuth/HTTP Dexcom + Cashflow connectors (v0 is mock-only); Inngest-async source sync (v0 syncs inline).
- Timezone-aware day boundaries (v0 uses UTC).
- Health-data encryption at rest; export/delete UI (deletion-by-source is supported at the data layer).
```

- [ ] **Step 2: Commit.**
```bash
git add docs/v0-acceptance.md
git commit -m "docs: add v0 acceptance checklist"
```

- [ ] **Step 3: Final gate.**
  - `pnpm exec tsc --noEmit` → no errors.
  - `pnpm lint` → clean.
  - `pnpm test` → all pass (prior 53 + acceptance test ~1, and the mock/insights tests still green) — report the count.
  - `pnpm build` → success; routes: `/`, `/today`, `/timeline`, `/insights`, `/sources`, `/api/{health,timeline,annotations,observations?,insights,insights/dismiss,sources,sources/[id]/sync,inngest,jobs/daily-snapshot,jobs/insights}` as applicable; build works without `DATABASE_URL`.
  - `git status -s` → only `components/timeline/AnnotationForm.tsx` (intentional residual).

---

## Task 5: Manual verification against Railway (documented; run by Connor)

- [ ] Fresh `pnpm db:seed`; `pnpm dev` (+ `inngest-cli dev`).
- [ ] Nav bar moves between all four screens; `/today` finance card shows $246.50; `/timeline` shows glucose + transactions + manual events with source badges; `/insights` shows ≥5 insights incl. spike-without-context + high-spend, dismiss persists; `/sources` syncs Dexcom/Cashflow idempotently.

**Phase G complete when:** the final gate (Task 4 Step 3) is green and the acceptance checklist holds; Blackbox v0 is feature-complete.

---

## Self-Review

**Spec coverage:** acceptance criteria enumerated + mapped (Task 4 doc); ≥5 mock insights now deterministically true + tested (Task 2); README explains setup (Task 3); cross-screen nav (Task 1). Post-v0 items explicitly listed as non-blocking follow-ups.

**Placeholder scan:** full content in every step; the layout edit is described precisely (read + insert `<Nav/>`); the follow-ups are intentionally documentation, not code. No TODO/TBD. ✓

**Type consistency:** `Nav` imported in layout; `InsightObservation`/`InsightEvent`/`RawEventInput`/`SourceType`/`normalize`/`computeInsights` + the four mock exports referenced with correct names in the acceptance test. ✓

---

## Execution Handoff

Subagent-driven. The acceptance test (Task 2) + the phase get fresh-eyes review at the Task 4 gate. After the gate: push; `gh pr create`/merge are agent-policy-blocked — hand the PR to Connor (push succeeds; provide the compare URL). This is the final v0 phase — after it merges, Blackbox v0 is complete.
