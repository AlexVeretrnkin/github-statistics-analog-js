CREATE TYPE "public"."research_pipeline_run_status" AS ENUM('receiving', 'committed', 'failed');--> statement-breakpoint
CREATE TABLE "active_research_datasets" (
	"source" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"source_data_through" date NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npm_download_daily" (
	"package" text NOT NULL,
	"date" date NOT NULL,
	"downloads" bigint NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npm_download_daily_package_date_pk" PRIMARY KEY("package","date"),
	CONSTRAINT "npm_download_daily_downloads_nonnegative" CHECK ("npm_download_daily"."downloads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "npm_download_daily_staging" (
	"run_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"package" text NOT NULL,
	"date" date NOT NULL,
	"downloads" bigint NOT NULL,
	CONSTRAINT "npm_download_daily_staging_run_id_package_date_pk" PRIMARY KEY("run_id","package","date"),
	CONSTRAINT "npm_download_daily_staging_downloads_nonnegative" CHECK ("npm_download_daily_staging"."downloads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "npm_download_monthly" (
	"package" text NOT NULL,
	"period" date NOT NULL,
	"downloads" bigint NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "npm_download_monthly_package_period_pk" PRIMARY KEY("package","period"),
	CONSTRAINT "npm_download_monthly_downloads_nonnegative" CHECK ("npm_download_monthly"."downloads" >= 0)
);
--> statement-breakpoint
CREATE TABLE "research_ingestion_batches" (
	"run_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"row_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_ingestion_batches_run_id_batch_number_pk" PRIMARY KEY("run_id","batch_number")
);
--> statement-breakpoint
CREATE TABLE "research_pipeline_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pipeline_name" text NOT NULL,
	"source" text NOT NULL,
	"schema_version" integer NOT NULL,
	"status" "research_pipeline_run_status" NOT NULL,
	"git_sha" text DEFAULT '' NOT NULL,
	"source_data_through" date NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"staged_row_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "active_research_datasets" ADD CONSTRAINT "active_research_datasets_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npm_download_daily" ADD CONSTRAINT "npm_download_daily_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npm_download_daily_staging" ADD CONSTRAINT "npm_download_daily_staging_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npm_download_daily_staging" ADD CONSTRAINT "npm_staging_batch_fk" FOREIGN KEY ("run_id","batch_number") REFERENCES "public"."research_ingestion_batches"("run_id","batch_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npm_download_monthly" ADD CONSTRAINT "npm_download_monthly_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_ingestion_batches" ADD CONSTRAINT "research_ingestion_batches_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_pipeline_runs_source_started_idx" ON "research_pipeline_runs" USING btree ("source","started_at");