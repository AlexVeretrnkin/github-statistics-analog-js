import {
  commitNpmIngestionRun,
  createNpmIngestionRun,
  getNpmIngestionCheckpoint,
  writeNpmIngestionBatch,
} from './npm-ingestion.js';
import { NPM_PACKAGES } from '@github-statistics/ingestion-contracts';
import { listNpmMonthlyDownloads } from './read.js';

const describeDatabase = process.env['RUN_DATABASE_INTEGRATION_TESTS'] === 'true'
  ? describe
  : describe.skip;

describeDatabase('npm PostgreSQL ingestion', () => {
  it('publishes a complete run and derives completed monthly totals', async () => {
    const run = await createNpmIngestionRun({
      gitSha: 'integration-test',
      metadata: { test: true },
      schemaVersion: 1,
      sourceDataThrough: '2015-01-31',
    });
    const rows = NPM_PACKAGES.flatMap((packageName, packageIndex) =>
      januaryDates().map((date, dateIndex) => ({
        date,
        downloads: packageIndex * 100 + dateIndex + 1,
        package: packageName,
      })),
    );

    await writeNpmIngestionBatch(run.runId, 0, { rows });
    const committed = await commitNpmIngestionRun(run.runId);

    expect(committed.status).toBe('committed');
    expect(committed.rowCount).toBe(93);
    await expect(commitNpmIngestionRun(run.runId)).resolves.toMatchObject({
      status: 'committed',
    });

    const checkpoint = await getNpmIngestionCheckpoint();
    expect(checkpoint).toMatchObject({
      activeRunId: run.runId,
      latestCompletedMonth: '2015-01-01',
      latestDate: '2015-01-31',
      sourceDataThrough: '2015-01-31',
    });

    const monthly = await listNpmMonthlyDownloads();
    expect(monthly).toHaveLength(3);
    expect(monthly.find((row) => row.package === 'react')).toMatchObject({
      downloads: 496,
      period: '2015-01-01',
    });

    const incrementalRun = await createNpmIngestionRun({
      gitSha: 'integration-test-2',
      metadata: { test: true },
      schemaVersion: 1,
      sourceDataThrough: '2015-02-28',
    });
    const incrementalDates = dateRange('2015-01-18', '2015-02-28');
    const incrementalRows = NPM_PACKAGES.flatMap((packageName) =>
      incrementalDates.map((date) => ({ date, downloads: 1, package: packageName })),
    );

    await writeNpmIngestionBatch(incrementalRun.runId, 0, { rows: incrementalRows });
    await commitNpmIngestionRun(incrementalRun.runId);

    expect(await getNpmIngestionCheckpoint()).toMatchObject({
      activeRunId: incrementalRun.runId,
      latestCompletedMonth: '2015-02-01',
      latestDate: '2015-02-28',
    });
    const updatedMonthly = await listNpmMonthlyDownloads();
    expect(updatedMonthly.find((row) =>
      row.package === 'react' && row.period === '2015-01-01'
    )?.downloads).toBe(167);
    expect(updatedMonthly.find((row) =>
      row.package === 'react' && row.period === '2015-02-01'
    )?.downloads).toBe(28);
  });
});

function januaryDates(): string[] {
  return Array.from({ length: 31 }, (_, index) =>
    `2015-01-${String(index + 1).padStart(2, '0')}`,
  );
}

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
