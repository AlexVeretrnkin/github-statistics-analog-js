import type {
  GitHubStarFramework,
  GitHubStarRepository,
  GoogleTrendsFramework,
  NpmPackage,
} from '@github-statistics/ingestion-contracts';
import { asc } from 'drizzle-orm';

import { closeResearchDatabase, getResearchDatabase } from './client.js';
import {
  githubStarDaily,
  githubStarMonthly,
  googleTrendsMonthly,
  googleTrendsWeekly,
  npmDownloadDaily,
  npmDownloadMonthly,
} from './schema.js';

export interface GitHubStarsDailyQualityRow {
  date: string;
  framework: GitHubStarFramework;
  newStars: number;
  repository: GitHubStarRepository;
}

export interface GitHubStarsMonthlyQualityRow {
  framework: GitHubStarFramework;
  newStars: number;
  period: string;
  repository: GitHubStarRepository;
}

export interface GoogleTrendsWeeklyQualityRow {
  date: string;
  framework: GoogleTrendsFramework;
  interest: number;
}

export interface GoogleTrendsMonthlyQualityRow {
  framework: GoogleTrendsFramework;
  interest: number;
  period: string;
}

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

export async function listGoogleTrendsWeeklyForQuality(): Promise<GoogleTrendsWeeklyQualityRow[]> {
  const rows = await getResearchDatabase()
    .select({
      date: googleTrendsWeekly.date,
      framework: googleTrendsWeekly.framework,
      interest: googleTrendsWeekly.interest,
    })
    .from(googleTrendsWeekly)
    .orderBy(asc(googleTrendsWeekly.framework), asc(googleTrendsWeekly.date));

  return rows.map((row) => ({
    ...row,
    framework: row.framework as GoogleTrendsFramework,
  }));
}

export async function listGoogleTrendsMonthlyForQuality(): Promise<GoogleTrendsMonthlyQualityRow[]> {
  const rows = await getResearchDatabase()
    .select({
      framework: googleTrendsMonthly.framework,
      interest: googleTrendsMonthly.interest,
      period: googleTrendsMonthly.period,
    })
    .from(googleTrendsMonthly)
    .orderBy(asc(googleTrendsMonthly.framework), asc(googleTrendsMonthly.period));

  return rows.map((row) => ({
    ...row,
    framework: row.framework as GoogleTrendsFramework,
  }));
}

export async function listGitHubStarsDailyForQuality(): Promise<GitHubStarsDailyQualityRow[]> {
  const rows = await getResearchDatabase().select({
    date: githubStarDaily.date,
    framework: githubStarDaily.framework,
    newStars: githubStarDaily.newStars,
    repository: githubStarDaily.repository,
  }).from(githubStarDaily)
    .orderBy(asc(githubStarDaily.repository), asc(githubStarDaily.date));

  return rows.map((row) => ({
    date: row.date,
    framework: row.framework as GitHubStarFramework,
    newStars: row.newStars,
    repository: row.repository as GitHubStarRepository,
  }));
}

export async function listGitHubStarsMonthlyForQuality(): Promise<GitHubStarsMonthlyQualityRow[]> {
  const rows = await getResearchDatabase().select({
    framework: githubStarMonthly.framework,
    newStars: githubStarMonthly.newStars,
    period: githubStarMonthly.period,
    repository: githubStarMonthly.repository,
  }).from(githubStarMonthly)
    .orderBy(asc(githubStarMonthly.repository), asc(githubStarMonthly.period));

  return rows.map((row) => ({
    framework: row.framework as GitHubStarFramework,
    newStars: row.newStars,
    period: row.period,
    repository: row.repository as GitHubStarRepository,
  }));
}

export { closeResearchDatabase };
