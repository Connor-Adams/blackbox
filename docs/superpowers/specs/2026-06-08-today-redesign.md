# /today Redesign: Health Trends + Glucose Correlation Engine

**Date:** 2026-06-08
**Status:** Design approved

## Summary

Replace the current /today page (3 flat stat cards + top-4 insights) with a data-rich, 3-column health briefing. Finance card removed entirely — cashflow data lags ~1 month, making it useless for a "today" view. The page becomes glucose-centric, showing per-metric trends with 7d/30d baselines and a correlation engine that discovers how sleep, activity, and recovery affect glucose.

All computation is pre-computed in the daily job pipeline. No external AI calls. Every insight is deterministic and evidence-linked.

## What Changes

### Removed
- Finance card (spend total, transaction count) — removed from /today entirely. Cashflow data remains accessible on /timeline and /sources.

### Added
- **`daily_trend` table** — per-metric trend tracking with 7d/30d baselines, direction, streak
- **`correlation` table** — threshold-split glucose correlation analysis against co-factors
- **Trend computation step** in daily job pipeline
- **Correlation computation step** in daily job pipeline
- **4 new insight rules** — `glucose_sleep_correlation`, `glucose_activity_correlation`, `glucose_recovery_correlation`, `trending_metric`
- **Redesigned /today page** — 3-column data-dense layout

### Modified
- Daily job pipeline order: `sync → snapshot → trends → correlations → insights`
- `computeInsights` extended with correlation-derived insight rules

## Domain Model

### `daily_trend` table

Tracks per-metric trend data. One row per user per date per metric.

```
daily_trend
─────────────────────────
id              uuid PK
userId          uuid FK → user
date            date
metric          observationMetric
value           numeric          -- today's summary value
baseline7d      numeric          -- 7-day trailing avg (excludes today)
baseline30d     numeric          -- 30-day trailing avg (excludes today)
delta7dPct      numeric          -- % change: (value - baseline7d) / baseline7d * 100
delta30dPct     numeric          -- % change: (value - baseline30d) / baseline30d * 100
direction       text             -- "rising" | "falling" | "stable"
streak          integer          -- consecutive days in same direction (0 if stable)
sampleCount7d   integer          -- days with data in 7d window
sampleCount30d  integer          -- days with data in 30d window
createdAt       timestamp
updatedAt       timestamp
UNIQUE (userId, date, metric)
```

**Direction thresholds:** `|delta7dPct| < 3%` → stable. Otherwise rising/falling based on sign.

**Metrics tracked:** All metrics present in the user's DailySnapshot summaries + observations. In practice for v0: `glucose` (avg), `sleep_duration`, `sleep_score`, `steps`, `intensity_minutes`, `hrv`, `resting_heart_rate`, `body_battery`, `training_readiness`.

### `correlation` table

Threshold-split glucose correlation analysis. One row per user per date per co-factor.

```
correlation
─────────────────────────
id                uuid PK
userId            uuid FK → user
date              date
primaryMetric     text             -- "glucose" for v0
coFactorMetric    text             -- e.g. "sleep_duration"
windowDays        integer          -- 30
sampleCount       integer          -- days with BOTH metrics present
splitThreshold    numeric          -- e.g. 6.0 for sleep hours
splitLabel        text             -- e.g. "6h sleep"
primaryWhenBelow  numeric          -- avg glucose when co-factor < threshold
primaryWhenAbove  numeric          -- avg glucose when co-factor ≥ threshold
countBelow        integer          -- days in below-bucket
countAbove        integer          -- days in above-bucket
deltaAbs          numeric          -- |primaryWhenBelow - primaryWhenAbove|
deltaPct          numeric          -- % difference
significant       boolean          -- sampleCount ≥ 14 AND deltaPct ≥ 10%
narrative         text             -- pre-rendered sentence
evidenceJson      jsonb            -- { dates, splitThreshold, bucketAvgs, ... }
createdAt         timestamp
updatedAt         timestamp
UNIQUE (userId, date, primaryMetric, coFactorMetric)
```

### Split thresholds by co-factor

| Co-factor | Threshold | Type | Rationale |
|-----------|-----------|------|-----------|
| sleep_duration | 6h | clinical | Standard minimum sleep recommendation |
| sleep_score | 60 | clinical | Garmin "fair" boundary |
| steps | 7000 | clinical | WHO activity guideline proxy |
| intensity_minutes | 15 | clinical | ~half of daily target |
| hrv | user's 30d median | personal | HRV varies wildly between individuals |
| resting_heart_rate | user's 30d median | personal | Same — absolute values are meaningless cross-person |
| body_battery | 50 | clinical | Garmin midpoint |
| training_readiness | 40 | clinical | Garmin "low" boundary |

Clinical thresholds are interpretable labels ("nights under 6h sleep"). Personal medians are used where absolute values differ too much between people.

### Significance criteria

A correlation is `significant` when:
1. `sampleCount ≥ 14` — minimum data points with both metrics present
2. `deltaPct ≥ 10%` — glucose difference between buckets is at least 10%
3. Both buckets have `≥ 4` data points — avoid one-sided splits

Correlations below threshold still stored and displayed (with "insufficient" badge) so the user sees the engine collecting data.

## Pipeline

### Current flow
```
sync connectors → snapshot → insights
```

### New flow
```
sync connectors → snapshot → trends → correlations → insights
```

Trends before correlations (correlations could reference trend data). Insights last (can now reference trend + correlation findings).

### `computeTrends(userId, date)` → DailyTrend[]

1. Fetch 30 days of DailySnapshots (date-30 to date-1, excluding today)
2. Fetch today's snapshot
3. For each metric with data in today's snapshot:
   - Compute 7d trailing average from snapshots (require ≥ 3 data points)
   - Compute 30d trailing average from snapshots (require ≥ 7 data points)
   - Compute delta percentages
   - Determine direction from 7d delta (|delta| < 3% = stable)
   - Compute streak: count consecutive prior days with same direction
   - Upsert `daily_trend` row
4. Return array of computed trends

Pure function over snapshot data. No side effects except DB upsert.

### `computeCorrelations(userId, date)` → Correlation[]

1. Fetch 30 days of DailySnapshots
2. For each co-factor in the configured list:
   - Find days where both glucose AND co-factor have data
   - Skip if sampleCount < 14
   - Determine split threshold (clinical default or personal median)
   - Split days into above/below buckets
   - Skip if either bucket has < 4 data points
   - Compute avg glucose in each bucket
   - Compute deltaAbs, deltaPct
   - Mark `significant` if deltaPct ≥ 10%
   - Render narrative: "Glucose avg {below} on {label} under {threshold} vs {above} with {threshold}+ ({pct}% {higher|lower}, {n} data points)"
   - Upsert `correlation` row with evidence JSON
3. Return array of computed correlations

### New insight rules

Added to existing `computeInsights`:

| insightType | Trigger | Severity |
|-------------|---------|----------|
| `glucose_sleep_correlation` | Sleep↔glucose correlation is significant | notice |
| `glucose_activity_correlation` | Steps or intensity↔glucose correlation is significant | notice |
| `glucose_recovery_correlation` | Any of HRV/RHR/battery/readiness↔glucose is significant | notice |
| `trending_metric` | Any health metric has 5+ day streak in one direction | info |

These read from the `correlation` and `daily_trend` tables. Narrative style: numbers woven into sentences — "Glucose averages 7.8 on nights under 6h sleep vs 6.2 with 6h+ (26% higher, 18 data points)."

## /today Page Layout

3-column data-dense layout, optimized for ultrawide/high-DPI. Monospace font. Dark theme. Everything visible without scrolling on a wide monitor.

### Left column (320px fixed)

**Glucose Hero:**
- Large avg value (36px)
- 7d and 30d delta percentages with color coding (amber = rising, green = falling/improving)
- Direction badge + streak
- 7d sparkline (CSS or SVG)
- Stats row: min, max, TIR%, σ (variability)

**Vitals & Activity table:**
- One row per tracked metric
- 4 columns: name, current value, delta% vs 30d, direction + streak
- Color coding: amber for concerning deltas, green for positive, grey for stable
- Covers: sleep, sleep score, steps, intensity min, HRV, resting HR, body battery, readiness

### Center column (fluid)

**Trend Narratives:**
- Full-sentence summaries for each metric group
- Left-border color coding: amber for significant/concerning, green for positive, grey for neutral
- Example: "Glucose avg 7.2 mmol/L, up 8% from 7d baseline of 6.67 — rising 3 consecutive days. Variability also elevated (σ 2.8 vs 2.1 baseline)."

**Glucose Correlations:**
- 2-column grid of correlation cards
- Each card shows: co-factor label, significance badge, two buckets (below/above threshold with avg glucose in each), narrative sentence, metadata (n, delta, confidence)
- Significant correlations get amber border
- Insufficient-data correlations shown with "insufficient" or "pending" badge and collection progress

### Right column (340px fixed)

**Recovery Snapshot:**
- 2×2 grid: readiness, body battery, sleep score, HRV
- Each cell: value (color-coded), delta vs 30d, direction label

**Insights:**
- Full list of active insights (not capped at 4)
- Severity dot (critical=red, warning=amber, notice=blue, info=grey)
- Type code (monospace), title, summary

**Today's Log:**
- Chronological annotation list
- Time, type badge, body text

## Narrative Voice

Numbers woven into sentences. Not clinical/terse, not conversational — factual with context.

**Pattern:** "{Metric} {current value}, {direction} {delta}% from {window} baseline of {baseline value} — {additional context like streak or related signal}."

**Examples:**
- "Glucose avg 7.2 mmol/L, up 8% from 7d baseline of 6.67 — rising 3 consecutive days."
- "Sleep averaging 5.8h this week, down 18% from 7.1h baseline. Three of last five nights under 6h."
- "Glucose averages 7.8 on nights under 6h sleep vs 6.2 with 6h+ (26% higher, 18 data points)."

Correlation narratives are pre-rendered at compute time and stored in the `correlation.narrative` column. Trend narratives are rendered at page level from `daily_trend` data (template-based, not stored) since they're simple string interpolation from the trend fields.

## Data Availability

The user started logging today (2026-06-08). The system handles sparse data gracefully:

- Trends require ≥ 3 data points for 7d baseline, ≥ 7 for 30d baseline. Below that, show value only with "collecting" badge.
- Correlations require ≥ 14 data points with both metrics. Below that, show progress ("8 of 14 points collected") with "pending" badge.
- No correlations surface as insights until significant.
- The /today page renders whatever data exists — empty panels show "awaiting data" rather than hiding.

## Constraints

- **No external AI calls.** All computation is deterministic threshold/baseline/bucket math.
- **Evidence-linked.** Every insight and correlation carries source data (observation IDs, dates, computed values).
- **Idempotent.** All jobs upsert on unique keys. Safe to re-run.
- **Primary metric is glucose for v0.** Correlation engine only computes glucose as the dependent variable. Multi-axis correlations (e.g. sleep↔HRV) are future scope.
- **Nutrition correlations deferred.** Garmin nutrition data not yet synced. The co-factor list is configurable — nutrition slots in when the data source exists.

## Out of Scope

- Multi-axis correlations (non-glucose primary)
- Garmin nutrition/food data connector
- Finance on /today
- Stress metric (user says useless)
- Mobile-optimized layout (ultrawide-first for now)
- Sparkline rendering implementation details (CSS clip-path or lightweight SVG — decided during implementation)
