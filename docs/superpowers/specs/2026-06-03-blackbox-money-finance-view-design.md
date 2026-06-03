# Blackbox — `/money` Finance View Design Spec

- **Date:** 2026-06-03
- **Status:** Approved (Connor, 2026-06-03)
- **Builds on:** the real Cashflow connector (`lib/connectors/cashflow-api.ts`, `claude/blackbox-cashflow-connector`) — this feature stacks on that branch.

## Goal

A dedicated `/money` screen that turns blackbox's cashflow data into a rich, scannable financial view: top-line metrics + charts (live from cashflow's reporting API) plus recent/largest transactions (from blackbox's already-ingested data, drilling back into the timeline).

## Approach — live aggregates + inspectable transactions

The screen **live-fetches cashflow's purpose-built aggregates** (`/summary`, `/accounts`, `/cashflow/monthly`, `/spending/by-category`) for the tiles + charts, and **reads blackbox's ingested transactions** from the DB for the recent/largest lists. Each section degrades independently (`Promise.allSettled`) — if cashflow's API is unreachable or the token is bad, the live tiles show "unavailable" but the page + DB-backed transaction lists still render. No crash.

Rejected: *all-live* (re-fetch everything per load — heavier, loses inspectability) and *all-derived* (recompute categories/monthly in blackbox — duplicates cashflow's logic, loses income/trend signal). Live-aggregates-plus-ingested-transactions wins on accuracy + on-thesis drill-down.

## Data layer

Extend `lib/connectors/cashflow-api.ts` with thin, typed GETs (same `cfr_` Bearer auth + `CASHFLOW_API_BASE_URL`, all under `/api/v1`), each testable with a stubbed `fetchImpl`:
- `fetchCashflowSummary(baseUrl, token, fetchImpl?)` → `{ currency, netWorth, liquidCash, monthlyBurn, monthlyIncome, monthlySavingsRate, runwayMonths, … }`
- `fetchCashflowAccounts(baseUrl, token, fetchImpl?)` → `{ accounts: [{ id, name, type, currency, balance, updatedAt }] }`
- `fetchCashflowMonthly(baseUrl, token, fetchImpl?)` → `{ months: [{ month, income, expenses, netCashflow, savingsRate }] }`
- `fetchCashflowByCategory(baseUrl, token, range, fetchImpl?)` → `{ categories: [{ name, amount, percentage, transactionCount, trendVsPreviousPeriod }] }`

An orchestrator `getCashflowDashboard()` reads `CASHFLOW_API_BASE_URL`/`CASHFLOW_API_TOKEN` from `env()`, runs the four fetches with `Promise.allSettled`, and returns `{ summary: …|null, accounts: …|null, monthly: …|null, byCategory: …|null }` (null per section on failure). Lives in `lib/connectors/cashflow-dashboard.ts` (or alongside the api module).

## Screen — `app/money/page.tsx` (server, `force-dynamic`)

Calls `getCashflowDashboard()` (live) + queries the DB for recent + largest cashflow transactions (last 90 days, from `timeline_event`/`observation` where `sourceType = 'cashflow'`). Passes everything to a client `<FinanceView>`. Added to the shared `Nav` (`Money`).

Sections (top → bottom):
1. **Top-line tiles** (reuse `StateCard`): Net worth · Liquid cash · Monthly burn · Runway (months) · Savings rate — from `summary`. "Unavailable" state if `summary` is null.
2. **Cashflow over time** — Recharts bar/line of monthly income vs expenses (+ net) — from `monthly`.
3. **Spending by category** — horizontal bars (amount + %), top N, with the period trend arrow — from `byCategory`.
4. **Accounts** — balances list (name, type, currency, balance) — from `accounts`.
5. **Transactions** — Recent + Largest (90d) from the DB; each row links to that day on `/timeline` (`/timeline?date=…`).

## Error handling

Per-section graceful degradation via `Promise.allSettled` in `getCashflowDashboard`. A null section renders an inline "unavailable" placeholder; the DB-backed transaction section is always available. The page never throws on a cashflow outage.

## Testing

- Unit (Vitest, DB-free): the 4 new fetch fns with a stubbed `fetchImpl` (URL/path, Bearer header, response shaping, non-200 → throws) + any pure number formatting.
- `getCashflowDashboard` degradation: with a stub where some fetches reject, it returns nulls for those and values for the rest (no throw).
- Page + components: tsc + build verified; visual check on the live app.

## Out of scope

Persisting/ingesting the aggregates (they stay a display-layer fetch); editing finance data (read-only); multi-currency normalization (display the `currency` field as-is); Dexcom/health views (cashflow-first).

## Notes

- No new cashflow-side work or new token — all four endpoints are existing GET `/api/v1/*` with the same `cfr_` Bearer.
- `FinanceView` is a client component; it imports only DTO/types from the data layer (no `@/lib/db/*` runtime import in the client).
