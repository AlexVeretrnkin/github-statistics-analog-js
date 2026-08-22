import type { NpmPackage } from '@github-statistics/ingestion-contracts';
import { asc } from 'drizzle-orm';

import { closeResearchDatabase, getResearchDatabase } from './client.js';
import { npmDownloadDaily, npmDownloadMonthly } from './schema.js';

export interface NpmDailyQualityRow {
  date: string;
  downloads: number;
  package: NpmPackage;
}

export interface NpmMonthlyQualityRow {
  downloads: number;
  package: NpmPackage;
  period: string;
}

export async function listNpmDailyForQuality(): Promise<NpmDailyQualityRow[]> {
  const rows = await getResearchDatabase()
    .select({
      date: npmDownloadDaily.date,
      downloads: npmDownloadDaily.downloads,
      package: npmDownloadDaily.package,
    })
    .from(npmDownloadDaily)
    .orderBy(asc(npmDownloadDaily.package), asc(npmDownloadDaily.date));

  return rows.map((row) => ({ ...row, package: row.package as NpmPackage }));
}

export async function listNpmMonthlyForQuality(): Promise<NpmMonthlyQualityRow[]> {
  const rows = await getResearchDatabase()
    .select({
      downloads: npmDownloadMonthly.downloads,
      package: npmDownloadMonthly.package,
      period: npmDownloadMonthly.period,
    })
    .from(npmDownloadMonthly)
    .orderBy(asc(npmDownloadMonthly.package), asc(npmDownloadMonthly.period));

  return rows.map((row) => ({ ...row, package: row.package as NpmPackage }));
}

export { closeResearchDatabase };
