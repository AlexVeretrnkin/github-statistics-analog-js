import type {
  GitHubStarFramework,
  GitHubStarRepository,
  GoogleTrendsFramework,
  NpmPackage,
} from '@github-statistics/ingestion-contracts';
import { asc, eq, lt } from 'drizzle-orm';

import { googleTrendsCompletedMonths } from './google-trends-months.js';
import { getResearchDatabase } from './client.js';
import { githubStarMonthly, googleTrendsWeekly, researchPipelineRuns, npmDownloadMonthly } from './schema.js';

export interface GitHubStarsMonthlyDatabaseRow {
  framework: GitHubStarFramework;
  newStars: number;
  period: string;
  repository: GitHubStarRepository;
}

export interface GoogleTrendsMonthlyDatabaseRow {
  framework: GoogleTrendsFramework;
  interest: number;
  period: string;
}

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
    .where(lt(npmDownloadMonthly.period, currentMonthStartUtc()))
    .orderBy(asc(npmDownloadMonthly.package), asc(npmDownloadMonthly.period));

  return rows.map((row) => ({
    downloads: row.downloads,
    package: row.package as NpmMonthlyDatabaseRow['package'],
    period: row.period,
  }));
}

export async function listGoogleTrendsMonthly(): Promise<GoogleTrendsMonthlyDatabaseRow[]> {
  // Validate legacy datasets at read time as well as new ingestion commits.
  const rows = await getResearchDatabase().select({
    framework: googleTrendsWeekly.framework,
    date: googleTrendsWeekly.date,
    interest: googleTrendsWeekly.interest,
    metadata: researchPipelineRuns.metadata,
  }).from(googleTrendsWeekly)
    .innerJoin(researchPipelineRuns, eq(googleTrendsWeekly.lastRunId, researchPipelineRuns.id))
    .orderBy(asc(googleTrendsWeekly.framework), asc(googleTrendsWeekly.date));
  const metadata = rows[0]?.metadata;
  const collectedBoundary = metadata?.['completedMonthBefore'];
  const boundary = typeof collectedBoundary === 'string' && collectedBoundary < currentMonthStartUtc()
    ? collectedBoundary : currentMonthStartUtc();
  const completeWeeksThrough = metadata?.['completeWeeksThrough'];
  return googleTrendsCompletedMonths(
    rows, boundary, typeof completeWeeksThrough === 'string' ? completeWeeksThrough : undefined,
  ).map(row => ({ ...row, framework: row.framework as GoogleTrendsFramework }));
}

export async function listGitHubStarsMonthly(): Promise<GitHubStarsMonthlyDatabaseRow[]> {
  const rows = await getResearchDatabase()
    .select({
      framework: githubStarMonthly.framework,
      newStars: githubStarMonthly.newStars,
      period: githubStarMonthly.period,
      repository: githubStarMonthly.repository,
    })
    .from(githubStarMonthly)
    .where(lt(githubStarMonthly.period, currentMonthStartUtc()))
    .orderBy(asc(githubStarMonthly.repository), asc(githubStarMonthly.period));

  return rows.map((row) => ({
    framework: row.framework as GitHubStarFramework,
    newStars: row.newStars,
    period: row.period,
    repository: row.repository as GitHubStarRepository,
  }));
}

function currentMonthStartUtc(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}
