# Blackbox v0 — Acceptance

Maps [build-requirements.md](build-requirements.md) §"Acceptance criteria for v0" to how each is met.

| Criterion | Status | Verified by |
|---|---|---|
| App runs locally from a fresh clone | ✅ | `pnpm install && pnpm dev` (README) |
| Database migrations apply cleanly | ✅ | `pnpm db:migrate` (Railway / dev DB) |
| Mock data can be seeded | ✅ | `pnpm db:seed` (idempotent; manual + dexcom + cashflow) |
| `/today` shows a useful daily summary | ✅ | live-computed glucose / finance / annotation cards |
| `/timeline` shows manual events, transactions, and glucose together | ✅ | `/timeline` event list + glucose strip + source filter |
| Manual annotations can be created | ✅ | annotation form → `POST /api/annotations` → timeline |
| Source records preserve raw imported payloads | ✅ | `raw_event.payload` (jsonb); normalization reads from it |
| Daily snapshots can be computed | ✅ | `computeDailySnapshot` + `daily-snapshot` Inngest job |
| Insights can be computed and inspected | ✅ | `computeInsights` + `/insights` evidence drilldown |
| Source attribution is visible | ✅ | source badges on the timeline; `sourceType` / `rawEventId` on every record |
| Repeated import / snapshot / insight jobs are idempotent | ✅ | dedupe keys + upserts (unit-tested) |
| README explains setup | ✅ | README Development + Deploy |
| ≥5 generated mock insights | ✅ | `lib/domain/insights.acceptance.test.ts` (5 types from the seed) |

## Known post-v0 follow-ups (non-blocking)

- Snapshot / insight upserts use select-then-insert; swap to `ON CONFLICT DO UPDATE` before concurrent job retries (the insight one needs a `(userId, date, insightType)` unique-index migration).
- Personal / historical baselines for insight thresholds (v0 uses fixed thresholds).
- Real OAuth / HTTP Dexcom + Cashflow connectors (v0 is mock-only); Inngest-async source sync (v0 syncs inline).
- Timezone-aware day boundaries (v0 uses UTC).
- Health-data encryption at rest; export / delete UI (deletion-by-source is supported at the data layer).
