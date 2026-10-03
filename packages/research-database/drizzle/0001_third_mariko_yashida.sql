CREATE TABLE "google_trends_monthly" (
	"framework" text NOT NULL,
	"period" date NOT NULL,
	"interest" double precision NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_trends_monthly_framework_period_pk" PRIMARY KEY("framework","period"),
	CONSTRAINT "google_trends_monthly_interest_range" CHECK ("google_trends_monthly"."interest" >= 0 AND "google_trends_monthly"."interest" <= 100)
);
--> statement-breakpoint
CREATE TABLE "google_trends_weekly" (
	"framework" text NOT NULL,
	"date" date NOT NULL,
	"interest" double precision NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_trends_weekly_framework_date_pk" PRIMARY KEY("framework","date"),
	CONSTRAINT "google_trends_weekly_interest_range" CHECK ("google_trends_weekly"."interest" >= 0 AND "google_trends_weekly"."interest" <= 100)
);
--> statement-breakpoint
CREATE TABLE "google_trends_weekly_staging" (
	"run_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"framework" text NOT NULL,
	"date" date NOT NULL,
	"interest" double precision NOT NULL,
	CONSTRAINT "google_trends_weekly_staging_run_id_framework_date_pk" PRIMARY KEY("run_id","framework","date"),
	CONSTRAINT "google_trends_weekly_staging_interest_range" CHECK ("google_trends_weekly_staging"."interest" >= 0 AND "google_trends_weekly_staging"."interest" <= 100)
);
--> statement-breakpoint
ALTER TABLE "google_trends_monthly" ADD CONSTRAINT "google_trends_monthly_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_trends_weekly" ADD CONSTRAINT "google_trends_weekly_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_trends_weekly_staging" ADD CONSTRAINT "google_trends_weekly_staging_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_trends_weekly_staging" ADD CONSTRAINT "google_trends_staging_batch_fk" FOREIGN KEY ("run_id","batch_number") REFERENCES "public"."research_ingestion_batches"("run_id","batch_number") ON DELETE no action ON UPDATE no action;