import { GITHUB_STAR_REPOSITORIES } from '@github-statistics/ingestion-contracts';

import {
  commitGitHubStarsIngestionRun,
  createGitHubStarsIngestionRun,
  getGitHubStarsIngestionCheckpoint,
  writeGitHubStarsIngestionBatch,
} from './github-stars-ingestion.js';
import { listGitHubStarsMonthly } from './read.js';

const describeDatabase = process.env['RUN_DATABASE_INTEGRATION_TESTS'] === 'true'
  ? describe
  : describe.skip;

const FRAMEWORK_BY_REPOSITORY = {
  'angular/angular': 'Angular',
  'facebook/react': 'React',
  'vuejs/core': 'Vue',
} as const;

describeDatabase('GitHub stars PostgreSQL ingestion', () => {
  it('atomically replaces daily histories and derives completed monthly sums', async () => {
    const run = await createGitHubStarsIngestionRun({
      completedMonthBefore: '2026-02-01',
      gitSha: 'integration-test',
      metadata: { apiVersion: '2026-03-10' },
      schemaVersion: 1,
      sourceDataThrough: '2026-02-15',
    });
    const rows = GITHUB_STAR_REPOSITORIES.flatMap((repository, repositoryIndex) =>
      dateRange(`2026-01-0${repositoryIndex + 1}`, '2026-02-15').map((date) => ({
        date,
        framework: FRAMEWORK_BY_REPOSITORY[repository],
        newStars: repositoryIndex + 1,
        repository,
      })),
    );

    await writeGitHubStarsIngestionBatch(run.runId, 0, { rows: rows.slice(0, 60) });
    await writeGitHubStarsIngestionBatch(run.runId, 1, { rows: rows.slice(60) });
    const committed = await commitGitHubStarsIngestionRun(run.runId);

    expect(committed).toMatchObject({ rowCount: rows.length, status: 'committed' });
    await expect(commitGitHubStarsIngestionRun(run.runId)).resolves.toMatchObject({
      status: 'committed',
    });
    expect(await getGitHubStarsIngestionCheckpoint()).toMatchObject({
      activeRunId: run.runId,
      latestCompletedMonth: '2026-01-01',
      latestDate: '2026-02-15',
      sourceDataThrough: '2026-02-15',
    });

    const monthly = await listGitHubStarsMonthly();
    expect(monthly).toHaveLength(3);
    expect(monthly.find((row) => row.repository === 'facebook/react')).toMatchObject({
      framework: 'React',
      newStars: 31,
      period: '2026-01-01',
    });
    expect(monthly.find((row) => row.repository === 'angular/angular')).toMatchObject({
      framework: 'Angular',
      newStars: 60,
      period: '2026-01-01',
    });
    expect(monthly.some((row) => row.period === '2026-02-01')).toBe(false);
  });
});

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
