CREATE TABLE "correlation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"primary_metric" text NOT NULL,
	"co_factor_metric" text NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"split_threshold" double precision NOT NULL,
	"split_label" text NOT NULL,
	"primary_when_below" double precision,
	"primary_when_above" double precision,
	"count_below" integer DEFAULT 0 NOT NULL,
	"count_above" integer DEFAULT 0 NOT NULL,
	"delta_abs" double precision,
	"delta_pct" double precision,
	"significant" integer DEFAULT 0 NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_trend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"baseline_7d" double precision,
	"baseline_30d" double precision,
	"delta_7d_pct" double precision,
	"delta_30d_pct" double precision,
	"direction" text DEFAULT 'stable' NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"sample_count_7d" integer DEFAULT 0 NOT NULL,
	"sample_count_30d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "correlation_user_date_metrics_uq" ON "correlation" USING btree ("user_id","date","primary_metric","co_factor_metric");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_trend_user_date_metric_uq" ON "daily_trend" USING btree ("user_id","date","metric");