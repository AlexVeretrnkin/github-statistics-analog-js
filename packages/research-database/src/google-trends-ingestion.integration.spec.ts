import { GOOGLE_TRENDS_FRAMEWORKS } from '@github-statistics/ingestion-contracts';

import {
  commitGoogleTrendsIngestionRun,
  createGoogleTrendsIngestionRun,
  getGoogleTrendsIngestionCheckpoint,
  writeGoogleTrendsIngestionBatch,
} from './google-trends-ingestion.js';
import { listGoogleTrendsMonthly } from './read.js';

const describeDatabase = process.env['RUN_DATABASE_INTEGRATION_TESTS'] === 'true'
  ? describe
  : describe.skip;

describeDatabase('Google Trends PostgreSQL ingestion', () => {
  it('atomically publishes weekly values and derives completed monthly averages', async () => {
    const dates = weeklyDates('2021-01-03', 260);
    const run = await createGoogleTrendsIngestionRun({
      completedMonthBefore: '2025-12-01',
      gitSha: 'integration-test',
      metadata: { category: 31, window: 'rolling-five-years' },
      schemaVersion: 1,
      sourceDataThrough: dates.at(-1)!,
    });
    const rows = GOOGLE_TRENDS_FRAMEWORKS.flatMap((framework, frameworkIndex) =>
      dates.map((date, index) => ({
        date,
        framework,
        interest: (frameworkIndex * 10 + index) % 101,
      })),
    );

    await writeGoogleTrendsIngestionBatch(run.runId, 0, { rows: rows.slice(0, 500) });
    await writeGoogleTrendsIngestionBatch(run.runId, 1, { rows: rows.slice(500) });
    const committed = await commitGoogleTrendsIngestionRun(run.runId);

    expect(committed).toMatchObject({ rowCount: 780, status: 'committed' });
    await expect(commitGoogleTrendsIngestionRun(run.runId)).resolves.toMatchObject({
      status: 'committed',
    });
    expect(await getGoogleTrendsIngestionCheckpoint()).toMatchObject({
      activeRunId: run.runId,
      latestDate: dates.at(-1),
      sourceDataThrough: dates.at(-1),
    });
    const monthly = await listGoogleTrendsMonthly();
    expect(monthly.length).toBeGreaterThan(0);
    expect(new Set(monthly.map((row) => row.framework))).toEqual(
      new Set(GOOGLE_TRENDS_FRAMEWORKS),
    );
    expect(monthly.every((row) => row.interest >= 0 && row.interest <= 100)).toBe(true);
  });
});

function weeklyDates(start: string, count: number): string[] {
  const cursor = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, () => {
    const date = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    return date;
  });
}
