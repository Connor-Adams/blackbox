import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---- Enum-like unions (text columns; flexible, no enum migrations needed) ----
export const sourceTypes = ["manual", "cashflow", "dexcom", "calendar", "garmin", "healthkit"] as const;
export type SourceType = (typeof sourceTypes)[number];

export const sourceStatuses = ["active", "disconnected", "error"] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export const importStatuses = ["pending", "running", "success", "error"] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const observationMetrics = [
  "glucose", "cash_balance", "daily_spend", "transaction_amount",
  "heart_rate", "hrv", "stress", "steps", "sleep_duration", "body_battery",
  "resting_heart_rate", "spo2", "respiration", "vo2max",
  "floors", "intensity_minutes", "calories", "training_readiness",
  // body composition + wellness
  "weight", "bmi", "body_fat", "muscle_mass", "body_water", "hydration",
  "blood_pressure_systolic", "blood_pressure_diastolic", "sleep_score",
  // fitness / performance
  "fitness_age", "endurance_score", "hill_score",
  "race_time_5k", "race_time_10k", "race_time_half_marathon", "race_time_marathon",
] as const;
export type ObservationMetric = (typeof observationMetrics)[number];

export const timelineEventTypes = [
  "manual_note", "meal", "insulin", "glucose_event", "transaction", "cashflow_summary",
  "sleep", "workout", "calendar_block", "travel", "stress_event",
] as const;
export type TimelineEventType = (typeof timelineEventTypes)[number];

export const annotationTypes = [
  "note", "meal", "insulin", "exercise", "sick", "travel", "stress", "caffeine", "alcohol", "medication",
] as const;
export type AnnotationType = (typeof annotationTypes)[number];

export const insightSeverities = ["info", "notice", "warning", "critical"] as const;
export type InsightSeverity = (typeof insightSeverities)[number];

export const insightStatuses = ["active", "dismissed", "archived"] as const;
export type InsightStatus = (typeof insightStatuses)[number];

export const trendDirections = ["rising", "falling", "stable"] as const;
export type TrendDirection = (typeof trendDirections)[number];

type Json = Record<string, unknown>;

// ---- Tables ----

export const sourceConnection = pgTable("source_connection", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  sourceType: text("source_type").$type<SourceType>().notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").$type<SourceStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Json>().notNull().default({}),
});

export const importBatch = pgTable("import_batch", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceConnectionId: uuid("source_connection_id").notNull().references(() => sourceConnection.id),
  status: text("status").$type<ImportStatus>().notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsFound: integer("records_found").notNull().default(0),
  recordsCreated: integer("records_created").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  error: text("error"),
  metadata: jsonb("metadata").$type<Json>().notNull().default({}),
});

export const rawEvent = pgTable(
  "raw_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceConnectionId: uuid("source_connection_id").notNull().references(() => sourceConnection.id),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    sourceRecordId: text("source_record_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    payloadHash: text("payload_hash").notNull(),
  },
  (t) => [
    uniqueIndex("raw_event_source_record_uq")
      .on(t.sourceConnectionId, t.sourceRecordId)
      .where(sql`${t.sourceRecordId} is not null`),
    uniqueIndex("raw_event_payload_hash_uq")
      .on(t.sourceConnectionId, t.payloadHash)
      .where(sql`${t.sourceRecordId} is null`),
  ],
);

export const observation = pgTable(
  "observation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    rawEventId: uuid("raw_event_id").notNull().references(() => rawEvent.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    metric: text("metric").$type<ObservationMetric>().notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
  },
  (t) => [
    index("observation_user_metric_time_idx").on(t.userId, t.metric, t.observedAt),
    uniqueIndex("observation_raw_metric_uq").on(t.rawEventId, t.metric),
  ],
);

export const timelineEvent = pgTable(
  "timeline_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    rawEventId: uuid("raw_event_id").references(() => rawEvent.id),
    sourceType: text("source_type").$type<SourceType>().notNull(),
    eventType: text("event_type").$type<TimelineEventType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
  },
  (t) => [
    index("timeline_event_user_time_idx").on(t.userId, t.startedAt),
    uniqueIndex("timeline_event_raw_uq")
      .on(t.rawEventId)
      .where(sql`${t.rawEventId} is not null`),
  ],
);

export const annotation = pgTable(
  "annotation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    type: text("type").$type<AnnotationType>().notNull(),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: text("notes"),
    metadata: jsonb("metadata").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("annotation_user_time_idx").on(t.userId, t.startedAt)],
);

export const dailySnapshot = pgTable(
  "daily_snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    timezone: text("timezone").notNull(),
    summaryJson: jsonb("summary_json").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_snapshot_user_date_uq").on(t.userId, t.date)],
);

export const dailyTrend = pgTable(
  "daily_trend",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    metric: text("metric").$type<ObservationMetric>().notNull(),
    value: doublePrecision("value").notNull(),
    baseline7d: doublePrecision("baseline_7d"),
    baseline30d: doublePrecision("baseline_30d"),
    delta7dPct: doublePrecision("delta_7d_pct"),
    delta30dPct: doublePrecision("delta_30d_pct"),
    direction: text("direction").$type<TrendDirection>().notNull().default("stable"),
    streak: integer("streak").notNull().default(0),
    sampleCount7d: integer("sample_count_7d").notNull().default(0),
    sampleCount30d: integer("sample_count_30d").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_trend_user_date_metric_uq").on(t.userId, t.date, t.metric),
  ],
);

export const correlation = pgTable(
  "correlation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    primaryMetric: text("primary_metric").notNull(),
    coFactorMetric: text("co_factor_metric").notNull(),
    windowDays: integer("window_days").notNull().default(30),
    sampleCount: integer("sample_count").notNull().default(0),
    splitThreshold: doublePrecision("split_threshold").notNull(),
    splitLabel: text("split_label").notNull(),
    primaryWhenBelow: doublePrecision("primary_when_below"),
    primaryWhenAbove: doublePrecision("primary_when_above"),
    countBelow: integer("count_below").notNull().default(0),
    countAbove: integer("count_above").notNull().default(0),
    deltaAbs: doublePrecision("delta_abs"),
    deltaPct: doublePrecision("delta_pct"),
    significant: integer("significant").notNull().default(0),
    narrative: text("narrative").notNull().default(""),
    evidenceJson: jsonb("evidence_json").$type<Json>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("correlation_user_date_metrics_uq").on(t.userId, t.date, t.primaryMetric, t.coFactorMetric),
  ],
);

export const insight = pgTable(
  "insight",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    date: date("date"),
    timeRangeStart: timestamp("time_range_start", { withTimezone: true }).notNull(),
    timeRangeEnd: timestamp("time_range_end", { withTimezone: true }).notNull(),
    insightType: text("insight_type").notNull(),
    severity: text("severity").$type<InsightSeverity>().notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    evidenceJson: jsonb("evidence_json").$type<Json>().notNull().default({}),
    sourceObservationIds: jsonb("source_observation_ids").$type<string[]>().notNull().default([]),
    sourceTimelineEventIds: jsonb("source_timeline_event_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<InsightStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insight_user_date_idx").on(t.userId, t.date)],
);
