# Blackbox Vision

Blackbox is a private personal telemetry system.

It ingests health, activity, finance, calendar, and manual event data, then turns fragmented signals into timelines, correlations, and daily state summaries.

The goal is not another dashboard. The goal is to understand what changed, when, and why.

## North star

Blackbox is the private flight recorder for your life, optimized for finding patterns you would otherwise miss.

## Product thesis

Modern life creates useful data everywhere, but the data lives in isolated systems:

- glucose and metabolic data
- recovery, sleep, activity, HRV, stress, and training data
- cash position and spending patterns
- calendar context
- manual notes and annotations

Blackbox should unify those streams into one inspectable timeline.

## Product principles

### Timeline first

The primitive is not a chart. The primitive is a timestamped event or observation.

Every observation, event, and insight should be mappable onto a timeline.

### Context beats raw metrics

Raw metrics are useful, but context makes them valuable.

Bad:

> Your average glucose was 7.1 mmol/L.

Better:

> Your highest variability this week happened after short sleep, no morning activity, and a late meal.

Bad:

> You spent $430 on restaurants.

Better:

> Dining spend spiked on high-calendar-load days and low-recovery days.

### Private by default

Blackbox should assume sensitive data and treat privacy, local control, auditability, and exportability as first-class requirements.

Default posture:

- read-only integrations where possible
- append-only raw imports
- clear source attribution
- no silent mutation of source systems
- easy data deletion
- easy raw export
- no external AI calls without explicit configuration

### Explain deltas, not just states

The product should focus on changes:

- What is different today?
- What changed this week?
- What broke my baseline?
- What preceded the anomaly?
- What should I inspect first?

### Computed insight must be inspectable

Every insight should link back to the underlying observations and events.

If Blackbox says a spike followed poor sleep and a late meal, the user should be able to inspect the relevant readings, sleep window, timeline events, and assumptions.

## MVP

The first useful version should be small and sharp.

### MVP sources

1. Manual logs
2. Cashflow read-only connector
3. Dexcom connector or mocked glucose connector
4. Calendar connector if low-friction
5. Garmin / HealthKit later, not as a blocker

Dexcom plus manual events plus Cashflow is enough to prove the core timeline and insight model.

### MVP screens

#### Today

A compact state summary for the current day.

Possible state vector:

```txt
Glucose: stable / volatile / risky / unknown
Recovery: rested / cooked / unknown
Activity: inactive / active / overreached / unknown
Money: normal / watch / unusual / unknown
Schedule: calm / loaded / chaos / unknown
```

#### Timeline

The main product surface.

A single chronological view with overlays:

- glucose
- manual notes
- activity
- sleep/recovery
- calendar blocks
- transactions
- anomalies
- generated insights

#### Insights

Plain-English findings grounded in the user's own data.

The tone should be diagnostic, not motivational. Blackbox is a debugging tool, not a coach.

## Core data model

The system should preserve raw source data and derive normalized observations from it.

Core concepts:

```txt
SourceConnection
ImportBatch
RawEvent
Observation
TimelineEvent
DailySnapshot
Insight
Annotation
```

## Architecture direction

Recommended initial stack:

```txt
Next.js
TypeScript
Postgres
Drizzle
Tailwind
shadcn/ui
Recharts or ECharts
Inngest or Trigger.dev
```

Recommended repo structure:

```txt
blackbox/
  apps/
    web/
  packages/
    db/
    connectors/
    domain/
    ui/
  scripts/
  docs/
    vision.md
    build-requirements.md
```

## Integration strategy

### Cashflow

Cashflow should expose read-only endpoints for Blackbox.

Potential endpoints:

```txt
GET /api/blackbox/summary
GET /api/blackbox/accounts
GET /api/blackbox/cashflow/monthly
GET /api/blackbox/transactions/recent
GET /api/blackbox/events
```

Blackbox should not own finance logic. It should consume Cashflow as a source.

### Dexcom

Dexcom should be the first external health source.

Initial data needed:

- glucose value
- unit
- timestamp
- trend direction if available
- source reading ID if available

### Garmin / HealthKit

Future activity/recovery sources should eventually provide:

- sleep
- HRV
- resting heart rate
- stress
- steps
- workouts
- recovery signals

Do not make this the first blocker.

### Calendar

Calendar data is valuable because it explains context.

Useful derived metrics:

- meeting load
- focus time
- late events
- travel days
- schedule fragmentation
- high-context-switch days

## Insight engine

Start deterministic before adding LLMs.

Phase 1:

- rules and thresholds
- anomaly detection
- baseline comparisons
- deterministic summaries

Phase 2:

- correlation explorer
- repeated pattern detection
- cross-domain comparisons

Phase 3:

- LLM summaries grounded in computed findings

## Non-goals for v0

- social features
- coaching persona
- habit gamification
- complicated wearable integrations before the timeline works
- replacing Cashflow
- production healthcare claims
- medical advice

## Success criteria

Blackbox is working when it can reliably answer:

- What happened today?
- What changed this week?
- What events surrounded this anomaly?
- What pattern keeps repeating?
- What should I inspect first?

The product is great when it feels less like a dashboard and more like a debugger for your life.
