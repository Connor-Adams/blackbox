# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. The repo currently contains **only specs** — no application code, no `package.json`, no build/lint/test tooling. There is nothing to run yet.

The spec is detailed and authoritative. Read it before writing any code:

- [README.md](README.md) — one-page overview: stack, principles, screens, status.
- [docs/vision.md](docs/vision.md) — product thesis, principles, MVP scope, roadmap direction.
- [docs/build-requirements.md](docs/build-requirements.md) — **the concrete v0 contract**: exact domain-model fields, required screens + features, connector behavior, jobs/idempotency, API capabilities, tests, mock data, env vars, acceptance criteria, and a 15-step suggested implementation order. Start here when implementing.

Follow the implementation order in build-requirements.md (scaffold + DB → schema/migrations → mock seed → timeline model → `/timeline` → annotations → observations → `/today` → snapshot job → insight rules → `/insights` → sources page → connectors). Don't jump ahead to connectors or insights before the timeline and data model exist.

## What Blackbox is

A private personal-telemetry system — a "flight recorder for your life." It ingests health (glucose/Dexcom), finance (Cashflow), activity, calendar, and manual-log data; normalizes fragmented signals into timestamped observations and events; and surfaces them on one timeline with daily state summaries and inspectable insights. It is a *debugger for your life*, not a dashboard and not a coach.

## Architectural spine (the core invariant)

Data flows one direction through distinct layers — keep the layers separate:

```
SourceConnection → ImportBatch → RawEvent → { Observation, TimelineEvent } → DailySnapshot → Insight
                                 append-only,    normalized +                 computed       computed,
                                 untouched       source attribution            rollup        evidence-linked
                                 payload
```

- **RawEvent** stores the unchanged source payload. Never mutate it; normalization reads from it and must be replayable.
- **Observation / TimelineEvent** are the normalized records. Every one must carry source attribution: `sourceType`, `sourceRecordId`, import-batch ref, observed/occurred timestamp, and a `rawEventId` back-reference. The user must always be able to answer "where did this value come from?"
- **Insight** must carry its evidence (`sourceObservationIds`, `sourceTimelineEventIds`). Insights never ship as unexplained summaries.

**Never mix raw payloads with normalized domain records.** That separation is the whole point of the system.

### Idempotency
Every import / normalize / snapshot / insight job must be retry-safe. RawEvent dedupes on `(sourceConnectionId, sourceRecordId)`, falling back to `(sourceConnectionId, payloadHash)` when no source ID is available. Repeated imports must not create duplicate raw events, observations, or timeline events; snapshots and insights upsert.

### Connectors are source-agnostic
A connector emits Observations / TimelineEvents; the UI treats every source uniformly. Do **not** hard-code Dexcom (or any source) as a special path in the UI. Each connector supports a mock mode (local JSON) so local dev works with no external credentials.

## Hard constraints (from build-requirements.md — easy to violate by default)

- **Timeline-first.** The primary surface is a day timeline, not a generic widget dashboard. Don't build the dashboard first.
- **Deterministic insights before LLMs.** v0 insights are rule / threshold / baseline computations — testable and explainable. **No external AI calls in v0.**
- **Private by default.** Sensitive health + finance data. Secrets stay in env vars; local dev runs without production credentials (mock mode); deletion by source connection must be possible; no analytics/telemetry services in v0.
- **Mock data is required, not optional.** The app must be useful immediately on a fresh clone. Don't ship a screen without seedable mock data.
- **Cashflow is consumed read-only.** Blackbox does not own finance logic — it pulls from the sibling repo `Connor-Adams/cashflow` via `GET /api/blackbox/*` (mock acceptable until those endpoints exist). Never write back to any source system.

## Intended stack & structure (recommended in specs — not yet scaffolded)

Stack: **Next.js (App Router) · TypeScript · Postgres · Drizzle ORM · Tailwind · shadcn/ui · pnpm.**

Structure — prefer momentum over monorepo purity for v0. A flat `app/` + `lib/{db,domain,connectors}` is acceptable; the fuller intended shape is:

```
apps/web/{app,components,lib,server}
packages/{db,domain,connectors}
docs/
```

Routes: `/` redirects to `/today`; then `/today` (daily state), `/timeline` (main view), `/sources` (connections + sync), `/insights` (evidence explorer). Internal API capabilities (exact routes flexible): `GET /api/today`, `/api/timeline`, `/api/observations`, `/api/insights`; `POST /api/annotations`, `/api/sources/:id/sync`, `/api/jobs/{daily-snapshot,insights}`.

## Commands

None yet — no `package.json` exists. The first task is scaffolding the Next.js + Drizzle app (build-requirements.md step 1). Once scaffolded, **pnpm** is the package manager; document the setup / migrate / seed / test commands here at that point.
