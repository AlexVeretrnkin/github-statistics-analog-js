import { randomUUID } from 'node:crypto';

import {
  GITHUB_STAR_REPOSITORIES,
  type CreateGitHubStarsIngestionRunInput,
  type GitHubStarsIngestionBatchInput,
} from '@github-statistics/ingestion-contracts';
import { and, asc, count, eq, max, min, sql } from 'drizzle-orm';

import { getResearchDatabase } from './client.js';
import { ensureResearchDatabaseSchema } from './migrations.js';
import { IngestionStateError } from './npm-ingestion.js';
import {
  activeResearchDatasets,
  githubStarDaily,
  githubStarDailyStaging,
  githubStarMonthly,
  researchIngestionBatches,
  researchPipelineRuns,
} from './schema.js';

const FRAMEWORK_BY_REPOSITORY: Record<string, string> = {
  'angular/angular': 'Angular',
  'facebook/react': 'React',
  'vuejs/core': 'Vue',
};

interface StagedRepositorySummary {
  actualCount: number;
  expectedCount: number;
  framework: string;
  maxDate: string;
  minDate: string;
  repository: string;
}

export interface GitHubStarsIngestionCheckpoint {
  activeRunId: string | null;
  latestCompletedMonth: string | null;
  latestDate: string | null;
  sourceDataThrough: string | null;
}

export async function createGitHubStarsIngestionRun(
  input: CreateGitHubStarsIngestionRunInput,
): Promise<{ runId: string; status: 'receiving' }> {
  await ensureResearchDatabaseSchema();
  const runId = randomUUID();

  await getResearchDatabase().insert(researchPipelineRuns).values({
    gitSha: input.gitSha,
    id: runId,
    metadata: { ...input.metadata, completedMonthBefore: input.completedMonthBefore },
    pipelineName: 'framework-popularity-github-stars',
    schemaVersion: input.schemaVersion,
    source: 'github-stars',
    sourceDataThrough: input.sourceDataThrough,
    status: 'receiving',
  });

  return { runId, status: 'receiving' };
}

export async function writeGitHubStarsIngestionBatch(
  runId: string,
  batchNumber: number,
  input: GitHubStarsIngestionBatchInput,
): Promise<{ batchNumber: number; rowCount: number; stagedRowCount: number }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    const runs = await transaction.select({ status: researchPipelineRuns.status })
      .from(researchPipelineRuns)
      .where(and(eq(researchPipelineRuns.id, runId), eq(researchPipelineRuns.source, 'github-stars')))
      .for('update')
      .limit(1);
    requireReceivingRun(runs[0], runId);

    await transaction.delete(githubStarDailyStaging).where(and(
      eq(githubStarDailyStaging.runId, runId),
      eq(githubStarDailyStaging.batchNumber, batchNumber),
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
      await transaction.insert(githubStarDailyStaging).values(input.rows.map((row) => ({
        batchNumber,
        date: row.date,
        framework: row.framework,
        newStars: row.newStars,
        repository: row.repository,
        runId,
      })));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IngestionStateError(
          'A repository/date pair was already uploaded in another batch.',
          409,
        );
      }
      throw error;
    }

    const countRows = await transaction.select({ value: count() })
      .from(githubStarDailyStaging)
      .where(eq(githubStarDailyStaging.runId, runId));
    const stagedRowCount = countRows[0]?.value ?? 0;
    await transaction.update(researchPipelineRuns)
      .set({ stagedRowCount })
      .where(eq(researchPipelineRuns.id, runId));

    return { batchNumber, rowCount: input.rows.length, stagedRowCount };
  });
}

export async function commitGitHubStarsIngestionRun(
  runId: string,
): Promise<{ runId: string; status: 'committed'; rowCount: number; sourceDataThrough: string }> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('github-stars-commit'))`);

    const runs = await transaction.select({
      metadata: researchPipelineRuns.metadata,
      sourceDataThrough: researchPipelineRuns.sourceDataThrough,
      stagedRowCount: researchPipelineRuns.stagedRowCount,
      status: researchPipelineRuns.status,
    }).from(researchPipelineRuns).where(and(
      eq(researchPipelineRuns.id, runId),
      eq(researchPipelineRuns.source, 'github-stars'),
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
    if (completedMonthBefore !== `${run.sourceDataThrough.slice(0, 7)}-01`) {
      throw new IngestionStateError(
        'The GitHub stars completed-month boundary must be the collection month start.',
        422,
      );
    }

    const expectedCount = sql<number>`(
      max(${githubStarDailyStaging.date}) - min(${githubStarDailyStaging.date}) + 1
    )::integer`;
    const summaryRows = await transaction.select({
      actualCount: count(),
      expectedCount,
      framework: githubStarDailyStaging.framework,
      maxDate: max(githubStarDailyStaging.date),
      minDate: min(githubStarDailyStaging.date),
      repository: githubStarDailyStaging.repository,
    }).from(githubStarDailyStaging)
      .where(eq(githubStarDailyStaging.runId, runId))
      .groupBy(githubStarDailyStaging.repository, githubStarDailyStaging.framework)
      .orderBy(asc(githubStarDailyStaging.repository));
    const summaries = requireCompleteSummaries(summaryRows);
    validateStagedCoverage(summaries, run.sourceDataThrough);

    const activeRows = await transaction.select({
      sourceDataThrough: activeResearchDatasets.sourceDataThrough,
    }).from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'github-stars'))
      .limit(1);
    const activeThrough = activeRows[0]?.sourceDataThrough;
    if (activeThrough && run.sourceDataThrough < activeThrough) {
      throw new IngestionStateError(
        `The active GitHub stars dataset already covers ${activeThrough}.`,
        409,
      );
    }

    await transaction.delete(githubStarDaily);
    await transaction.insert(githubStarDaily).select(transaction.select({
      repository: githubStarDailyStaging.repository,
      framework: githubStarDailyStaging.framework,
      date: githubStarDailyStaging.date,
      newStars: githubStarDailyStaging.newStars,
      lastRunId: githubStarDailyStaging.runId,
      updatedAt: sql<Date>`now()`.as('updated_at'),
    }).from(githubStarDailyStaging).where(eq(githubStarDailyStaging.runId, runId)));

    await transaction.delete(githubStarMonthly);
    const monthExpression = sql<string>`date_trunc('month', ${githubStarDaily.date})::date`;
    await transaction.insert(githubStarMonthly).select(transaction.select({
      repository: githubStarDaily.repository,
      framework: githubStarDaily.framework,
      period: monthExpression.as('period'),
      newStars: sql<number>`sum(${githubStarDaily.newStars})::bigint`.mapWith(Number).as('new_stars'),
      lastRunId: sql<string>`${runId}::uuid`.as('last_run_id'),
      updatedAt: sql<Date>`now()`.as('updated_at'),
    }).from(githubStarDaily)
      .where(sql`${githubStarDaily.date} < ${completedMonthBefore}::date`)
      .groupBy(githubStarDaily.repository, githubStarDaily.framework, monthExpression));

    await transaction.insert(activeResearchDatasets)
      .values({ runId, source: 'github-stars', sourceDataThrough: run.sourceDataThrough })
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

export async function failGitHubStarsIngestionRun(runId: string, message: string): Promise<void> {
  await ensureResearchDatabaseSchema();
  const results = await getResearchDatabase().update(researchPipelineRuns)
    .set({ errorMessage: message, finishedAt: new Date(), status: 'failed' })
    .where(and(
      eq(researchPipelineRuns.id, runId),
      eq(researchPipelineRuns.source, 'github-stars'),
      eq(researchPipelineRuns.status, 'receiving'),
    )).returning({ id: researchPipelineRuns.id });

  if (results.length === 0) {
    throw new IngestionStateError(
      `Ingestion run ${runId} was not found or is no longer receiving data.`,
      409,
    );
  }
}

export async function getGitHubStarsIngestionCheckpoint(): Promise<GitHubStarsIngestionCheckpoint> {
  await ensureResearchDatabaseSchema();
  const database = getResearchDatabase();
  const [activeRows, dailyRows, monthlyRows] = await Promise.all([
    database.select({
      runId: activeResearchDatasets.runId,
      sourceDataThrough: activeResearchDatasets.sourceDataThrough,
    }).from(activeResearchDatasets)
      .where(eq(activeResearchDatasets.source, 'github-stars')).limit(1),
    database.select({ latestDate: max(githubStarDaily.date) }).from(githubStarDaily),
    database.select({ latestMonth: max(githubStarMonthly.period) }).from(githubStarMonthly),
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
      'The GitHub stars run is missing its completed-month boundary.',
      422,
    );
  }
  return value;
}

function requireCompleteSummaries(rows: Array<{
  actualCount: number;
  expectedCount: number;
  framework: string;
  maxDate: string | null;
  minDate: string | null;
  repository: string;
}>): StagedRepositorySummary[] {
  return rows.map((row) => {
    if (!row.minDate || !row.maxDate) {
      throw new IngestionStateError('The ingestion run contains no GitHub star rows.', 422);
    }
    return { ...row, maxDate: row.maxDate, minDate: row.minDate };
  });
}

function validateStagedCoverage(
  summaries: StagedRepositorySummary[],
  sourceDataThrough: string,
): void {
  const actual = summaries.map((row) => row.repository).sort();
  const expected = [...GITHUB_STAR_REPOSITORIES].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new IngestionStateError(`Expected GitHub star data for ${expected.join(', ')}.`, 422);
  }

  for (const summary of summaries) {
    if (summary.framework !== FRAMEWORK_BY_REPOSITORY[summary.repository]) {
      throw new IngestionStateError(
        `${summary.repository} is mapped to an unexpected framework.`,
        422,
      );
    }
    if (summary.actualCount !== summary.expectedCount) {
      throw new IngestionStateError(
        `${summary.repository} has missing dates between ${summary.minDate} and ${summary.maxDate}.`,
        422,
      );
    }
    if (summary.maxDate !== sourceDataThrough) {
      throw new IngestionStateError(
        `${summary.repository} ends at ${summary.maxDate}; expected ${sourceDataThrough}.`,
        422,
      );
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
