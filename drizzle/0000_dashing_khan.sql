CREATE TABLE "annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"records_found" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date,
	"time_range_start" timestamp with time zone NOT NULL,
	"time_range_end" timestamp with time zone NOT NULL,
	"insight_type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_timeline_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"source_type" text NOT NULL,
	"source_record_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"source_type" text NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_source_connection_id_source_connection_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_raw_event_id_raw_event_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_event" ADD CONSTRAINT "raw_event_source_connection_id_source_connection_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_event" ADD CONSTRAINT "raw_event_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_raw_event_id_raw_event_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotation_user_time_idx" ON "annotation" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_snapshot_user_date_uq" ON "daily_snapshot" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "insight_user_date_idx" ON "insight" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "observation_user_metric_time_idx" ON "observation" USING btree ("user_id","metric","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_raw_metric_uq" ON "observation" USING btree ("raw_event_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_event_source_record_uq" ON "raw_event" USING btree ("source_connection_id","source_record_id") WHERE "raw_event"."source_record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_event_payload_hash_uq" ON "raw_event" USING btree ("source_connection_id","payload_hash") WHERE "raw_event"."source_record_id" is null;--> statement-breakpoint
CREATE INDEX "timeline_event_user_time_idx" ON "timeline_event" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_event_raw_uq" ON "timeline_event" USING btree ("raw_event_id") WHERE "timeline_event"."raw_event_id" is not null;