CREATE TABLE "github_star_daily" (
	"repository" text NOT NULL,
	"framework" text NOT NULL,
	"date" date NOT NULL,
	"new_stars" bigint NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_star_daily_repository_date_pk" PRIMARY KEY("repository","date"),
	CONSTRAINT "github_star_daily_new_stars_nonnegative" CHECK ("github_star_daily"."new_stars" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github_star_daily_staging" (
	"run_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"repository" text NOT NULL,
	"framework" text NOT NULL,
	"date" date NOT NULL,
	"new_stars" bigint NOT NULL,
	CONSTRAINT "github_star_daily_staging_run_id_repository_date_pk" PRIMARY KEY("run_id","repository","date"),
	CONSTRAINT "github_star_daily_staging_new_stars_nonnegative" CHECK ("github_star_daily_staging"."new_stars" >= 0)
);
--> statement-breakpoint
CREATE TABLE "github_star_monthly" (
	"repository" text NOT NULL,
	"framework" text NOT NULL,
	"period" date NOT NULL,
	"new_stars" bigint NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_star_monthly_repository_period_pk" PRIMARY KEY("repository","period"),
	CONSTRAINT "github_star_monthly_new_stars_nonnegative" CHECK ("github_star_monthly"."new_stars" >= 0)
);
--> statement-breakpoint
ALTER TABLE "github_star_daily" ADD CONSTRAINT "github_star_daily_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_star_daily_staging" ADD CONSTRAINT "github_star_daily_staging_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_star_daily_staging" ADD CONSTRAINT "github_star_staging_batch_fk" FOREIGN KEY ("run_id","batch_number") REFERENCES "public"."research_ingestion_batches"("run_id","batch_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_star_monthly" ADD CONSTRAINT "github_star_monthly_last_run_id_research_pipeline_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."research_pipeline_runs"("id") ON DELETE no action ON UPDATE no action;