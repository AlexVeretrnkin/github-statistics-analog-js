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
  it('includes a certified October and rejects a missing week without replacing the active dataset', async () => {
    const dates = weeklyDates('2021-10-31', 261);
    expect(dates.at(-1)).toBe('2026-10-25');
    const input = {
      completedMonthBefore: '2026-11-01', gitSha: 'integration-test', schemaVersion: 1,
      sourceDataThrough: dates.at(-1)!, metadata: { completeWeeksThrough: '2026-10-31' },
    };
    const rows = GOOGLE_TRENDS_FRAMEWORKS.flatMap(framework =>
      dates.map(date => ({ framework, date, interest: 20 })),
    );
    const run = await createGoogleTrendsIngestionRun(input);
    await writeGoogleTrendsIngestionBatch(run.runId, 0, { rows });
    await commitGoogleTrendsIngestionRun(run.runId);
    const monthly = await listGoogleTrendsMonthly();
    expect(monthly.filter(row => row.period === '2026-10-01')).toHaveLength(3);
    expect(monthly.some(row => row.period === '2021-10-01' || row.period === '2026-11-01')).toBe(false);
    const gap = await createGoogleTrendsIngestionRun(input);
    await writeGoogleTrendsIngestionBatch(gap.runId, 0, {
      rows: rows.filter(row => row.date !== '2026-10-11'),
    });
    await expect(commitGoogleTrendsIngestionRun(gap.runId)).rejects.toThrow();
    expect((await getGoogleTrendsIngestionCheckpoint()).activeRunId).toBe(run.runId);
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
