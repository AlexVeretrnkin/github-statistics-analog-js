import type { NpmPackage } from '@github-statistics/ingestion-contracts';
import { asc } from 'drizzle-orm';

import { getResearchDatabase } from './client.js';
import { npmDownloadMonthly } from './schema.js';

export interface NpmMonthlyDatabaseRow {
  downloads: number;
  package: NpmPackage;
  period: string;
}

export async function listNpmMonthlyDownloads(): Promise<NpmMonthlyDatabaseRow[]> {
  const database = getResearchDatabase();
  const rows = await database
    .select({
      downloads: npmDownloadMonthly.downloads,
      package: npmDownloadMonthly.package,
      period: npmDownloadMonthly.period,
    })
    .from(npmDownloadMonthly)
    .orderBy(asc(npmDownloadMonthly.package), asc(npmDownloadMonthly.period));

  return rows.map((row) => ({
    downloads: row.downloads,
    package: row.package as NpmMonthlyDatabaseRow['package'],
    period: row.period,
  }));
}
