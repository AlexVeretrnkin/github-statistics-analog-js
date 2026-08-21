import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const pipelineRunStatus = pgEnum('research_pipeline_run_status', [
  'receiving',
  'committed',
  'failed',
]);

export const researchPipelineRuns = pgTable(
  'research_pipeline_runs',
  {
    id: uuid('id').primaryKey(),
    pipelineName: text('pipeline_name').notNull(),
    source: text('source').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    status: pipelineRunStatus('status').notNull(),
    gitSha: text('git_sha').notNull().default(''),
    sourceDataThrough: date('source_data_through', { mode: 'string' }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    stagedRowCount: integer('staged_row_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('research_pipeline_runs_source_started_idx').on(table.source, table.startedAt)],
);

export const researchIngestionBatches = pgTable(
  'research_ingestion_batches',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => researchPipelineRuns.id, { onDelete: 'cascade' }),
    batchNumber: integer('batch_number').notNull(),
    rowCount: integer('row_count').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.batchNumber] })],
);

export const npmDownloadDailyStaging = pgTable(
  'npm_download_daily_staging',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => researchPipelineRuns.id, { onDelete: 'cascade' }),
    batchNumber: integer('batch_number').notNull(),
    package: text('package').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    downloads: bigint('downloads', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.package, table.date] }),
    foreignKey({
      columns: [table.runId, table.batchNumber],
      foreignColumns: [researchIngestionBatches.runId, researchIngestionBatches.batchNumber],
      name: 'npm_staging_batch_fk',
    }),
    check('npm_download_daily_staging_downloads_nonnegative', sql`${table.downloads} >= 0`),
  ],
);

export const npmDownloadDaily = pgTable(
  'npm_download_daily',
  {
    package: text('package').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    downloads: bigint('downloads', { mode: 'number' }).notNull(),
    lastRunId: uuid('last_run_id')
      .notNull()
      .references(() => researchPipelineRuns.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.package, table.date] }),
    check('npm_download_daily_downloads_nonnegative', sql`${table.downloads} >= 0`),
  ],
);

export const npmDownloadMonthly = pgTable(
  'npm_download_monthly',
  {
    package: text('package').notNull(),
    period: date('period', { mode: 'string' }).notNull(),
    downloads: bigint('downloads', { mode: 'number' }).notNull(),
    lastRunId: uuid('last_run_id')
      .notNull()
      .references(() => researchPipelineRuns.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.package, table.period] }),
    check('npm_download_monthly_downloads_nonnegative', sql`${table.downloads} >= 0`),
  ],
);

export const activeResearchDatasets = pgTable('active_research_datasets', {
  source: text('source').primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => researchPipelineRuns.id),
  sourceDataThrough: date('source_data_through', { mode: 'string' }).notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
});
