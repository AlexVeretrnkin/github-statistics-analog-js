import { randomUUID } from 'node:crypto';

import {
  GOOGLE_TRENDS_FRAMEWORKS,
  type CreateGoogleTrendsIngestionRunInput,
  type GoogleTrendsIngestionBatchInput,
} from '@github-statistics/ingestion-contracts';
import { and, asc, count, eq, max, min, sql } from 'drizzle-orm';

import { getResearchDatabase } from './client.js';
import { IngestionStateError } from './npm-ingestion.js';
import { ensureResearchDatabaseSchema } from './migrations.js';
import {
  activeResearchDatasets,
  googleTrendsMonthly,
  googleTrendsWeekly,
  googleTrendsWeeklyStaging,
  researchIngestionBatches,
  researchPipelineRuns,
} from './schema.js';

interface StagedFrameworkSummary {
  actualCount: number;
  framework: string;
  maxDate: string;
  minDate: string;
}

export interface GoogleTrendsIngestionCheckpoint {
  activeRunId: string | null;
  latestCompletedMonth: string | null;
  latestDate: string | null;
  sourceDataThrough: string | null;
}

export async function createGoogleTrendsIngestionRun(
  input: CreateGoogleTrendsIngestionRunInput,
): Promise<{ runId: string; status: 'receiving' }> {
  await ensureResearchDatabaseSchema();
  const runId = randomUUID();

  await getResearchDatabase().insert(researchPipelineRuns).values({
    gitSha: input.gitSha,
    id: runId,
    metadata: { ...input.metadata, completedMonthBefore: input.completedMonthBefore },
    pipelineName: 'framework-popularity-google-trends',
    schemaVersion: input.schemaVersion,
    source: 'google-trends',
    sourceDataThrough: input.sourceDataThrough,
    status: 'receiving',
  });

  return { runId, status: 'receiving' };
}

export async function writeGoogleTrendsIngestionBatch(
  runId: string,
  batchNumber: number,
  input: GoogleTrendsIngestionBatchInput,
): Promise<{ batchNumber: number; rowCount: number; stagedRowCount: number }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    const runs = await transaction
      .select({ status: researchPipelineRuns.status })
      .from(researchPipelineRuns)
      .where(and(eq(researchPipelineRuns.id, runId), eq(researchPipelineRuns.source, 'google-trends')))
      .for('update')
      .limit(1);
    requireReceivingRun(runs[0], runId);

    await transaction.delete(googleTrendsWeeklyStaging).where(and(
      eq(googleTrendsWeeklyStaging.runId, runId),
      eq(googleTrendsWeeklyStaging.batchNumber, batchNumber),
    ));
    await transaction.delete(researchIngestionBatches).where(and(
      eq(researchIngestionBatches.runId, runId),
      eq(researchIngestionBatches.batchNumber, batchNumber),
    ));
    await transaction.insert(researchIngestionBatches).values({
      batchNumber,
      rowCount: input.rows.length,
      runId,
    });

    try {
      await transaction.insert(googleTrendsWeeklyStaging).values(input.rows.map((row) => ({
        batchNumber,
        date: row.date,
        framework: row.framework,
        interest: row.interest,
        runId,
      })));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IngestionStateError(
          'A framework/date pair was already uploaded in another batch.',
          409,
        );
      }
      throw error;
    }

    const countRows = await transaction
      .select({ value: count() })
      .from(googleTrendsWeeklyStaging)
      .where(eq(googleTrendsWeeklyStaging.runId, runId));
    const stagedRowCount = countRows[0]?.value ?? 0;

    await transaction.update(researchPipelineRuns)
      .set({ stagedRowCount })
      .where(eq(researchPipelineRuns.id, runId));

    return { batchNumber, rowCount: input.rows.length, stagedRowCount };
  });
}

export async function commitGoogleTrendsIngestionRun(
  runId: string,
): Promise<{ runId: string; status: 'committed'; rowCount: number; sourceDataThrough: string }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('google-trends-commit'))`);

    const runs = await transaction.select({
      metadata: researchPipelineRuns.metadata,
      sourceDataThrough: researchPipelineRuns.sourceDataThrough,
      stagedRowCount: researchPipelineRuns.stagedRowCount,
      status: researchPipelineRuns.status,
    }).from(researchPipelineRuns).where(and(
      eq(researchPipelineRuns.id, runId),
      eq(researchPipelineRuns.source, 'google-trends'),
    )).for('update').limit(1);
    const run = runs[0];

    if (!run) throw new IngestionStateError(`Ingestion run ${runId} was not found.`, 404);
    if (run.status === 'committed') {
      return {
        rowCount: run.stagedRowCount,
        runId,
        sourceDataThrough: run.sourceDataThrough,
        status: 'committed' as const,
      };
    }
    requireReceivingRun(run, runId);
    const completedMonthBefore = requireCompletedMonthBefore(run.metadata);

    const summaryRows = await transaction.select({
      actualCount: count(),
      framework: googleTrendsWeeklyStaging.framework,
      maxDate: max(googleTrendsWeeklyStaging.date),
      minDate: min(googleTrendsWeeklyStaging.date),
    }).from(googleTrendsWeeklyStaging)
      .where(eq(googleTrendsWeeklyStaging.runId, runId))
      .groupBy(googleTrendsWeeklyStaging.framework)
      .orderBy(asc(googleTrendsWeeklyStaging.framework));
    const summaries = requireCompleteSummaries(summaryRows);
    validateStagedCoverage(summaries, run.sourceDataThrough);
    const stagedKeys = await transaction.select({
      date: googleTrendsWeeklyStaging.date,
      framework: googleTrendsWeeklyStaging.framework,
    }).from(googleTrendsWeeklyStaging)
      .where(eq(googleTrendsWeeklyStaging.runId, runId))
      .orderBy(asc(googleTrendsWeeklyStaging.framework), asc(googleTrendsWeeklyStaging.date));
    validateMatchingDates(stagedKeys);

    const activeRows = await transaction.select({
      sourceDataThrough: activeResearchDatasets.sourceDataThrough,
    }).from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'google-trends'))
      .limit(1);
    const activeThrough = activeRows[0]?.sourceDataThrough;
    if (activeThrough && run.sourceDataThrough < activeThrough) {
      throw new IngestionStateError(
        `The active Google Trends dataset already covers ${activeThrough}.`,
        409,
      );
    }

    await transaction.delete(googleTrendsWeekly);
    await transaction.insert(googleTrendsWeekly).select(transaction.select({
      framework: googleTrendsWeeklyStaging.framework,
      date: googleTrendsWeeklyStaging.date,
      interest: googleTrendsWeeklyStaging.interest,
      lastRunId: googleTrendsWeeklyStaging.runId,
      updatedAt: sql<Date>`now()`.as('updated_at'),
    }).from(googleTrendsWeeklyStaging).where(eq(googleTrendsWeeklyStaging.runId, runId)));

    await transaction.delete(googleTrendsMonthly);
    const monthExpression = sql<string>`date_trunc('month', ${googleTrendsWeekly.date})::date`;
    await transaction.insert(googleTrendsMonthly).select(transaction.select({
      framework: googleTrendsWeekly.framework,
      period: monthExpression.as('period'),
      interest: sql<number>`avg(${googleTrendsWeekly.interest})::double precision`.as('interest'),
      lastRunId: sql<string>`${runId}::uuid`.as('last_run_id'),
      updatedAt: sql<Date>`now()`.as('updated_at'),
    }).from(googleTrendsWeekly)
      .where(sql`${googleTrendsWeekly.date} < ${completedMonthBefore}::date`)
      .groupBy(googleTrendsWeekly.framework, monthExpression));

    await transaction.insert(activeResearchDatasets)
      .values({ runId, source: 'google-trends', sourceDataThrough: run.sourceDataThrough })
      .onConflictDoUpdate({
        set: { activatedAt: new Date(), runId, sourceDataThrough: run.sourceDataThrough },
        target: activeResearchDatasets.source,
      });
    await transaction.update(researchPipelineRuns)
      .set({ errorMessage: null, finishedAt: new Date(), status: 'committed' })
      .where(eq(researchPipelineRuns.id, runId));

    return {
      rowCount: run.stagedRowCount,
      runId,
      sourceDataThrough: run.sourceDataThrough,
      status: 'committed' as const,
    };
  });
}

export async function failGoogleTrendsIngestionRun(runId: string, message: string): Promise<void> {
  await ensureResearchDatabaseSchema();
  const results = await getResearchDatabase().update(researchPipelineRuns)
    .set({ errorMessage: message, finishedAt: new Date(), status: 'failed' })
    .where(and(
      eq(researchPipelineRuns.id, runId),
      eq(researchPipelineRuns.source, 'google-trends'),
      eq(researchPipelineRuns.status, 'receiving'),
    )).returning({ id: researchPipelineRuns.id });

  if (results.length === 0) {
    throw new IngestionStateError(
      `Ingestion run ${runId} was not found or is no longer receiving data.`,
      409,
    );
  }
}

export async function getGoogleTrendsIngestionCheckpoint(): Promise<GoogleTrendsIngestionCheckpoint> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();
  const [activeRows, weeklyRows, monthlyRows] = await Promise.all([
    database.select({
      runId: activeResearchDatasets.runId,
      sourceDataThrough: activeResearchDatasets.sourceDataThrough,
    }).from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'google-trends')).limit(1),
    database.select({ latestDate: max(googleTrendsWeekly.date) }).from(googleTrendsWeekly),
    database.select({ latestMonth: max(googleTrendsMonthly.period) }).from(googleTrendsMonthly),
  ]);
  const active = activeRows[0];

  return {
    activeRunId: active?.runId ?? null,
    latestCompletedMonth: monthlyRows[0]?.latestMonth ?? null,
    latestDate: weeklyRows[0]?.latestDate ?? null,
    sourceDataThrough: active?.sourceDataThrough ?? null,
  };
}

function requireReceivingRun(
  run: { status: 'committed' | 'failed' | 'receiving' } | undefined,
  runId: string,
): asserts run is { status: 'receiving' } {
  if (!run) throw new IngestionStateError(`Ingestion run ${runId} was not found.`, 404);
  if (run.status !== 'receiving') {
    throw new IngestionStateError(
      `Ingestion run ${runId} is ${run.status} and cannot accept changes.`,
      409,
    );
  }
}

function requireCompletedMonthBefore(metadata: Record<string, unknown>): string {
  const value = metadata['completedMonthBefore'];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/.test(value)) {
    throw new IngestionStateError(
      'The Google Trends run is missing its completed-month boundary.',
      422,
    );
  }
  return value;
}

function requireCompleteSummaries(rows: Array<{
  actualCount: number;
  framework: string;
  maxDate: string | null;
  minDate: string | null;
}>): StagedFrameworkSummary[] {
  return rows.map((row) => {
    if (!row.minDate || !row.maxDate) {
      throw new IngestionStateError('The ingestion run contains no Google Trends rows.', 422);
    }
    return { ...row, maxDate: row.maxDate, minDate: row.minDate };
  });
}

function validateStagedCoverage(
  summaries: StagedFrameworkSummary[],
  sourceDataThrough: string,
): void {
  const actual = summaries.map((row) => row.framework).sort();
  const expected = [...GOOGLE_TRENDS_FRAMEWORKS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new IngestionStateError(`Expected Google Trends data for ${expected.join(', ')}.`, 422);
  }
  if (new Set(summaries.map((row) => row.minDate)).size !== 1 ||
      new Set(summaries.map((row) => row.maxDate)).size !== 1 ||
      new Set(summaries.map((row) => row.actualCount)).size !== 1) {
    throw new IngestionStateError(
      'All Google Trends frameworks must contain the same weekly observation window.',
      422,
    );
  }
  if (summaries.some((row) => row.maxDate !== sourceDataThrough)) {
    throw new IngestionStateError(`Google Trends data must end at ${sourceDataThrough}.`, 422);
  }
  if (summaries.some((row) => row.actualCount < 250)) {
    throw new IngestionStateError(
      'Each Google Trends framework must contain at least 250 weekly observations.',
      422,
    );
  }
}

function validateMatchingDates(rows: Array<{ date: string; framework: string }>): void {
  const datesByFramework = new Map<string, string[]>();
  for (const row of rows) {
    const dates = datesByFramework.get(row.framework) ?? [];
    dates.push(row.date);
    datesByFramework.set(row.framework, dates);
  }
  const signatures = [...datesByFramework.values()].map((dates) => dates.join(','));
  if (new Set(signatures).size !== 1) {
    throw new IngestionStateError(
      'All Google Trends frameworks must contain identical weekly dates.',
      422,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
