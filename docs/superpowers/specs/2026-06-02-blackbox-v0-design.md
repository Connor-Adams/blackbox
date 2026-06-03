# Blackbox v0 — Design Spec

- **Date:** 2026-06-02
- **Status:** Approved (Connor, 2026-06-02)
- **Scope:** Full v0 to the acceptance criteria in [docs/build-requirements.md](../../build-requirements.md).

This spec records the **build-approach decisions** layered on top of the existing product specs. It does not restate the full domain-model field lists or acceptance criteria — those live in [build-requirements.md](../../build-requirements.md) and remain authoritative.

## Context

Blackbox is a private personal-telemetry system — a "flight recorder for your life." It ingests fragmented personal data (glucose, finance, manual logs; later activity/calendar), normalizes it into timestamped observations and events, and surfaces a timeline, daily state summaries, and deterministic, inspectable insights.

- Product thesis / principles / roadmap: [docs/vision.md](../../vision.md)
- Concrete v0 contract (domain fields, screens, connector behavior, jobs, APIs, tests, acceptance criteria, 15-step implementation order): [docs/build-requirements.md](../../build-requirements.md)

## Goal (v0)

Build the **full v0** to build-requirements.md's acceptance criteria: runs from a fresh clone (deployed to Railway), migrations apply cleanly, mock data seeds, `/today` + `/timeline` + `/sources` + `/insights` all work, manual annotations can be created, raw payloads are preserved, daily snapshots and deterministic insights are computed and inspectable, source attribution is visible, all jobs are idempotent, and the README explains setup.

## Decided stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| DB | Postgres (hosted on **Railway**) |
| ORM / migrations | Drizzle + drizzle-kit |
| Styling / UI | Tailwind + shadcn/ui |
| Charts | Recharts |
| Package manager | pnpm |
| Jobs | **Inngest** |
| Tests | **Vitest** |
| Deploy | Railway |

## Deploy & dev model

- Single Next.js app deployed to Railway (web service + Railway Postgres). `DATABASE_URL` and connector secrets are Railway env vars.
- **No local Postgres.** Dev runs `next dev` against a Railway Postgres URL set in `.env.local`. DB-touching work targets that remote DB; the test suite avoids needing a DB (see Testing).
- **Inngest:** local dev via `inngest-cli dev`; production via Inngest Cloud syncing to the app's `/api/inngest` endpoint.
- **Migrations:** `drizzle-kit generate` authors migrations; `drizzle-kit migrate` runs as Railway's release/predeploy command so deploys apply schema cleanly.
- `.env.example` documents `DATABASE_URL`, `BLACKBOX_APP_URL`, `CASHFLOW_API_BASE_URL`, `CASHFLOW_API_TOKEN`, `DEXCOM_CLIENT_ID/SECRET/REDIRECT_URI`, and Inngest keys. External credentials are optional when connectors run in mock mode.

## Repo structure (flat single app)

Chosen over a monorepo per build-requirements' "do not overbuild the monorepo before the app exists." Packages can be extracted later if boundaries demand it.

```
app/
  today/  timeline/  sources/  insights/   # routes; / redirects to /today
  api/                                      # today, timeline, observations, insights,
                                            # annotations, sources/:id/sync, jobs/*, inngest
components/                                 # shadcn/ui + app components
lib/
  db/          # Drizzle schema, client, query helpers
  domain/      # PURE logic: normalize, snapshot, insights, ordering, dedup keys — NO db imports
  connectors/  # Connector interface + manual / cashflow(mock) / dexcom(mock)
  inngest/     # client + job functions
  mock/        # seed datasets + seed script
drizzle/       # generated SQL migrations
docs/
```

## Architecture

### Layers and the core boundary

Data flows one direction; layers stay separate (the central invariant from build-requirements: never mix raw payloads with normalized domain records).

```
SourceConnection → ImportBatch → RawEvent → { Observation, TimelineEvent } → DailySnapshot → Insight
                                 append-only,   normalized +                  computed       computed,
                                 untouched      source attribution             rollup        evidence-linked
```

- **Persistence** (`lib/db`): Drizzle tables for all 8 entities. Exact fields per build-requirements.md §Core domain model.
- **Domain** (`lib/domain`): **pure functions with no DB imports** —
  - `normalize(rawEvent) → { observations[], timelineEvents[] }`
  - `computeDailySnapshot(observations, events, tz, date) → summaryJson`
  - `computeInsights(observations, events, snapshot, baseline) → insight[]`
  - timeline ordering + dedup-key derivation

  This isolation is deliberate: it is what lets the spec's required tests run with fixtures and **no Postgres**, satisfying both "tests required" and "no local DB."

- **Connectors** (`lib/connectors`): interface `Connector { sync(opts) → RawPayload[] }`. Implementations: `manual` (writes from UI), `cashflowMock`, `dexcomMock` (read local JSON). The UI never special-cases a source — every source is just something that emits observations/events.

### Idempotency

Enforced primarily by DB constraints, verified by upsert logic:
- `RawEvent` unique on `(sourceConnectionId, sourceRecordId)`, fallback `(sourceConnectionId, payloadHash)` when no source record ID exists.
- Observations / TimelineEvents upsert on natural keys derived from their RawEvent.
- DailySnapshot upserts per `(userId, date)`; Insights upsert / dedupe on equivalent findings.
- Every Inngest job is therefore safe to retry — repeated runs create no duplicates.

### Jobs (Inngest)

Event chain, each step idempotent:
- `source/sync.requested` → `connector.sync()` → upsert RawEvents (import) → emit `raw/imported`
- `raw/imported` → `normalize()` → upsert Observations/TimelineEvents → emit `data/normalized`
- `data/normalized` **and** a daily cron → `computeDailySnapshot()` upsert → `computeInsights()` upsert

Triggers: `POST /api/sources/:id/sync` emits the first event; `POST /api/jobs/daily-snapshot` and `POST /api/jobs/insights` emit recompute events.

### Screens & API

Per build-requirements §Required screens / §API requirements:
- `/` → redirect `/today`
- `/today` — selected date, state cards (glucose / finance / annotations / insights), top insights, link to timeline
- `/timeline` — date picker, chronological event list, glucose strip (Recharts) when observations exist, manual annotation creation, event detail drawer/modal, source filters
- `/sources` — list sources, status, last sync, manual sync trigger, mock-import actions
- `/insights` — list by date, filter by type/severity/source, inspect evidence, dismiss
- API capabilities: `GET /api/{today,timeline,observations,insights}`, `POST /api/annotations`, `POST /api/sources/:id/sync`, `POST /api/jobs/{daily-snapshot,insights}` (exact routes flexible, capabilities fixed).

UI target: dense, calm, premium, diagnostic, not gamified. Empty states say what to connect or log next.

## Testing (Vitest)

Unit tests on the pure domain functions, all DB-free:
- normalization idempotency (dedup-key derivation)
- glucose snapshot computation
- finance snapshot computation
- deterministic insight rules
- manual annotation → timeline event mapping
- timeline ordering

Optional thin DB integration tests, gated on `DATABASE_URL` being present (run against Railway), are allowed but not required for v0. "Lightweight tests first; do not block v0 on perfect coverage."

## Mock data

The seed script feeds real RawEvents through the **real normalize → snapshot → insight path** (not hand-faked outputs), so seeding exercises the pipeline. Produces the required datasets: one normal glucose day, one volatile glucose day, one day with manual meal/insulin/stress notes, one finance-normal day, one unusual-spend day, and ≥5 generated insights. Mock data must exercise the timeline, today, and insights views.

## Resolved decisions (were open assumptions; now fixed for v0)

1. **Single user, no auth.** One seeded user row; `userId` resolved server-side to that user. (Spec carries `userId` everywhere but specifies no auth; private personal app.)
2. **Glucose default unit mmol/L** (matches vision's `7.1 mmol/L` example); `unit` stored per observation, so mg/dL is supported later without schema change.
3. **Recharts** for the glucose strip (lighter than ECharts; vision allowed either).
4. **Cashflow + Dexcom connectors are mock-only in v0**, behind the real `Connector` interface. Real Dexcom OAuth and real Cashflow endpoints are post-v0.
5. **Migrations applied on Railway deploy**; dev `DATABASE_URL` points at a Railway Postgres (no local DB).

## Out of scope for v0

Per build-requirements §Non-goals / §Future roadmap: real Dexcom OAuth, real Cashflow production endpoints, Garmin, HealthKit, calendar, mobile/local-first capture, LLM-generated summaries, multi-user/auth, encrypted-at-rest health storage, and export/delete UI (deletion **by source connection** is supported at the data layer; no polished UI required for v0). No generic widget dashboard; LLMs are not required for v0.

## Implementation order

Follow build-requirements.md §Suggested implementation order (15 steps): scaffold app + DB → core schema + migrations → mock seed → timeline event model → `/timeline` → manual annotations → observations + glucose mock → `/today` → daily snapshot job → deterministic insight rules → `/insights` → sources page → Cashflow connector interface → Dexcom connector interface → polish README + `.env.example`. Jobs wired through Inngest as each job lands.
