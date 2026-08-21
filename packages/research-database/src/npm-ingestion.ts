import { randomUUID } from 'node:crypto';

import {
  NPM_PACKAGES,
  type CreateNpmIngestionRunInput,
  type NpmIngestionBatchInput,
} from '@github-statistics/ingestion-contracts';
import {
  and,
  asc,
  between,
  count,
  eq,
  inArray,
  lt,
  max,
  min,
  sql,
} from 'drizzle-orm';

import { getResearchDatabase } from './client.js';
import { ensureResearchDatabaseSchema } from './migrations.js';
import {
  activeResearchDatasets,
  npmDownloadDaily,
  npmDownloadDailyStaging,
  npmDownloadMonthly,
  researchIngestionBatches,
  researchPipelineRuns,
} from './schema.js';

interface StagedPackageSummary {
  actualCount: number;
  expectedCount: number;
  maxDate: string;
  minDate: string;
  package: string;
}

interface PublicationState {
  activeSourceDataThrough: string | null;
  latestDate: string | null;
}

export interface NpmIngestionCheckpoint {
  activeRunId: string | null;
  latestCompletedMonth: string | null;
  latestDate: string | null;
  sourceDataThrough: string | null;
}

export class IngestionStateError extends Error {
  constructor(message: string, readonly statusCode: 404 | 409 | 422) {
    super(message);
    this.name = 'IngestionStateError';
  }
}

export async function createNpmIngestionRun(
  input: CreateNpmIngestionRunInput,
): Promise<{ runId: string; status: 'receiving' }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();
  const runId = randomUUID();

  await database.insert(researchPipelineRuns).values({
    gitSha: input.gitSha,
    id: runId,
    metadata: input.metadata,
    pipelineName: 'framework-popularity-npm',
    schemaVersion: input.schemaVersion,
    source: 'npm-downloads',
    sourceDataThrough: input.sourceDataThrough,
    status: 'receiving',
  });

  return { runId, status: 'receiving' };
}

export async function writeNpmIngestionBatch(
  runId: string,
  batchNumber: number,
  input: NpmIngestionBatchInput,
): Promise<{ batchNumber: number; rowCount: number; stagedRowCount: number }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    const runs = await transaction
      .select({ status: researchPipelineRuns.status })
      .from(researchPipelineRuns)
      .where(and(
        eq(researchPipelineRuns.id, runId),
        eq(researchPipelineRuns.source, 'npm-downloads'),
      ))
      .for('update')
      .limit(1);
    requireReceivingRun(runs[0], runId);

    await transaction.delete(npmDownloadDailyStaging).where(and(
      eq(npmDownloadDailyStaging.runId, runId),
      eq(npmDownloadDailyStaging.batchNumber, batchNumber),
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
      await transaction.insert(npmDownloadDailyStaging).values(
        input.rows.map((row) => ({
          batchNumber,
          date: row.date,
          downloads: row.downloads,
          package: row.package,
          runId,
        })),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IngestionStateError(
          'A package/date pair was already uploaded in another batch.',
          409,
        );
      }
      throw error;
    }

    const countRows = await transaction
      .select({ value: count() })
      .from(npmDownloadDailyStaging)
      .where(eq(npmDownloadDailyStaging.runId, runId));
    const stagedRowCount = countRows[0]?.value ?? 0;

    await transaction
      .update(researchPipelineRuns)
      .set({ stagedRowCount })
      .where(eq(researchPipelineRuns.id, runId));

    return { batchNumber, rowCount: input.rows.length, stagedRowCount };
  });
}

export async function commitNpmIngestionRun(
  runId: string,
): Promise<{ runId: string; status: 'committed'; rowCount: number; sourceDataThrough: string }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('npm-downloads-commit'))`);

    const runs = await transaction
      .select({
        sourceDataThrough: researchPipelineRuns.sourceDataThrough,
        stagedRowCount: researchPipelineRuns.stagedRowCount,
        status: researchPipelineRuns.status,
      })
      .from(researchPipelineRuns)
      .where(and(
        eq(researchPipelineRuns.id, runId),
        eq(researchPipelineRuns.source, 'npm-downloads'),
      ))
      .for('update')
      .limit(1);
    const run = runs[0];

    if (!run) {
      throw new IngestionStateError(`Ingestion run ${runId} was not found.`, 404);
    }

    if (run.status === 'committed') {
      return {
        rowCount: run.stagedRowCount,
        runId,
        sourceDataThrough: run.sourceDataThrough,
        status: 'committed' as const,
      };
    }

    requireReceivingRun(run, runId);

    const expectedCount = sql<number>`(
      max(${npmDownloadDailyStaging.date}) - min(${npmDownloadDailyStaging.date}) + 1
    )::integer`;
    const summaryRows = await transaction
      .select({
        actualCount: count(),
        expectedCount,
        maxDate: max(npmDownloadDailyStaging.date),
        minDate: min(npmDownloadDailyStaging.date),
        package: npmDownloadDailyStaging.package,
      })
      .from(npmDownloadDailyStaging)
      .where(eq(npmDownloadDailyStaging.runId, runId))
      .groupBy(npmDownloadDailyStaging.package)
      .orderBy(asc(npmDownloadDailyStaging.package));
    const summaries = requireCompleteSummaries(summaryRows);

    validateStagedCoverage(summaries, run.sourceDataThrough);

    const latestRows = await transaction
      .select({ latestDate: max(npmDownloadDaily.date) })
      .from(npmDownloadDaily);
    const activeRows = await transaction
      .select({ sourceDataThrough: activeResearchDatasets.sourceDataThrough })
      .from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'npm-downloads'))
      .limit(1);
    validatePublicationProgress(summaries, run.sourceDataThrough, {
      activeSourceDataThrough: activeRows[0]?.sourceDataThrough ?? null,
      latestDate: latestRows[0]?.latestDate ?? null,
    });

    const minDate = summaries.map((row) => row.minDate).sort()[0];
    const maxDate = summaries.map((row) => row.maxDate).sort().at(-1);

    if (!minDate || !maxDate) {
      throw new IngestionStateError('The ingestion run contains no npm rows.', 422);
    }

    await transaction.delete(npmDownloadDaily).where(and(
      inArray(npmDownloadDaily.package, [...NPM_PACKAGES]),
      between(npmDownloadDaily.date, minDate, maxDate),
    ));

    await transaction.insert(npmDownloadDaily).select(
      transaction
        .select({
          package: npmDownloadDailyStaging.package,
          date: npmDownloadDailyStaging.date,
          downloads: npmDownloadDailyStaging.downloads,
          lastRunId: npmDownloadDailyStaging.runId,
          updatedAt: sql<Date>`now()`.as('updated_at'),
        })
        .from(npmDownloadDailyStaging)
        .where(eq(npmDownloadDailyStaging.runId, runId)),
    );

    await transaction.delete(npmDownloadMonthly);
    const monthExpression = sql<string>`date_trunc('month', ${npmDownloadDaily.date})::date`;
    await transaction.insert(npmDownloadMonthly).select(
      transaction
        .select({
          package: npmDownloadDaily.package,
          period: monthExpression.as('period'),
          downloads: sql<number>`sum(${npmDownloadDaily.downloads})::bigint`
            .mapWith(Number)
            .as('downloads'),
          lastRunId: sql<string>`${runId}::uuid`.as('last_run_id'),
          updatedAt: sql<Date>`now()`.as('updated_at'),
        })
        .from(npmDownloadDaily)
        .where(lt(
          npmDownloadDaily.date,
          sql<string>`date_trunc('month', ${run.sourceDataThrough}::date + 1)::date`,
        ))
        .groupBy(npmDownloadDaily.package, monthExpression),
    );

    await transaction
      .insert(activeResearchDatasets)
      .values({ runId, source: 'npm-downloads', sourceDataThrough: run.sourceDataThrough })
      .onConflictDoUpdate({
        set: { activatedAt: new Date(), runId, sourceDataThrough: run.sourceDataThrough },
        target: activeResearchDatasets.source,
      });

    await transaction
      .update(researchPipelineRuns)
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

export async function failNpmIngestionRun(runId: string, message: string): Promise<void> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();
  const results = await database
    .update(researchPipelineRuns)
    .set({ errorMessage: message, finishedAt: new Date(), status: 'failed' })
    .where(and(
      eq(researchPipelineRuns.id, runId),
      eq(researchPipelineRuns.status, 'receiving'),
    ))
    .returning({ id: researchPipelineRuns.id });

  if (results.length === 0) {
    throw new IngestionStateError(
      `Ingestion run ${runId} was not found or is no longer receiving data.`,
      409,
    );
  }
}

export async function getNpmIngestionCheckpoint(): Promise<NpmIngestionCheckpoint> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();
  const [activeRows, dailyRows, monthlyRows] = await Promise.all([
    database
      .select({ runId: activeResearchDatasets.runId, sourceDataThrough: activeResearchDatasets.sourceDataThrough })
      .from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'npm-downloads'))
      .limit(1),
    database.select({ latestDate: max(npmDownloadDaily.date) }).from(npmDownloadDaily),
    database.select({ latestMonth: max(npmDownloadMonthly.period) }).from(npmDownloadMonthly),
  ]);
  const active = activeRows[0];

  return {
    activeRunId: active?.runId ?? null,
    latestCompletedMonth: monthlyRows[0]?.latestMonth ?? null,
    latestDate: dailyRows[0]?.latestDate ?? null,
    sourceDataThrough: active?.sourceDataThrough ?? null,
  };
}

function requireReceivingRun(
  run: { status: 'committed' | 'failed' | 'receiving' } | undefined,
  runId: string,
): asserts run is { status: 'receiving' } {
  if (!run) {
    throw new IngestionStateError(`Ingestion run ${runId} was not found.`, 404);
  }
  if (run.status !== 'receiving') {
    throw new IngestionStateError(
      `Ingestion run ${runId} is ${run.status} and cannot accept changes.`,
      409,
    );
  }
}

function requireCompleteSummaries(
  rows: Array<{
    actualCount: number;
    expectedCount: number;
    maxDate: string | null;
    minDate: string | null;
    package: string;
  }>,
): StagedPackageSummary[] {
  return rows.map((row) => {
    if (!row.minDate || !row.maxDate) {
      throw new IngestionStateError('The ingestion run contains no npm rows.', 422);
    }
    return { ...row, maxDate: row.maxDate, minDate: row.minDate };
  });
}

function validateStagedCoverage(
  summaries: StagedPackageSummary[],
  sourceDataThrough: string,
): void {
  const actualPackages = summaries.map((row) => row.package).sort();
  const expectedPackages = [...NPM_PACKAGES].sort();

  if (JSON.stringify(actualPackages) !== JSON.stringify(expectedPackages)) {
    throw new IngestionStateError(`Expected npm data for ${expectedPackages.join(', ')}.`, 422);
  }

  for (const summary of summaries) {
    if (summary.actualCount !== summary.expectedCount) {
      throw new IngestionStateError(
        `${summary.package} has missing dates between ${summary.minDate} and ${summary.maxDate}.`,
        422,
      );
    }
    if (summary.maxDate !== sourceDataThrough) {
      throw new IngestionStateError(
        `${summary.package} ends at ${summary.maxDate}; expected ${sourceDataThrough}.`,
        422,
      );
    }
  }

  if (new Set(summaries.map((row) => row.minDate)).size !== 1) {
    throw new IngestionStateError('All npm package batches must start on the same date.', 422);
  }
}

function validatePublicationProgress(
  summaries: StagedPackageSummary[],
  sourceDataThrough: string,
  state: PublicationState,
): void {
  const stagedStart = summaries[0]?.minDate;

  if (!stagedStart) {
    throw new IngestionStateError('The ingestion run contains no npm rows.', 422);
  }

  if (!state.latestDate) {
    if (stagedStart !== '2015-01-01') {
      throw new IngestionStateError('The first npm ingestion must start at 2015-01-01.', 422);
    }
    return;
  }

  if (state.activeSourceDataThrough && sourceDataThrough < state.activeSourceDataThrough) {
    throw new IngestionStateError(
      `The active npm dataset already covers ${state.activeSourceDataThrough}.`,
      409,
    );
  }

  const dayAfterLatest = new Date(`${state.latestDate}T00:00:00.000Z`);
  dayAfterLatest.setUTCDate(dayAfterLatest.getUTCDate() + 1);
  const latestAllowedStart = dayAfterLatest.toISOString().slice(0, 10);

  if (stagedStart > latestAllowedStart) {
    throw new IngestionStateError(
      `The npm ingestion starts at ${stagedStart}, leaving a gap after ${state.latestDate}.`,
      422,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
