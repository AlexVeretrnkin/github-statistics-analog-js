import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  listGitHubStarsMonthly,
  listGoogleTrendsMonthly,
  listNpmMonthlyDownloads,
  type GitHubStarsMonthlyDatabaseRow,
  type GoogleTrendsMonthlyDatabaseRow,
  type NpmMonthlyDatabaseRow,
} from '@github-statistics/research-database/read';

import type {
  FrameworkName,
  FrameworkForecastModel,
  FrameworkForecastSeries,
  FrameworkPopularityDiagnostic,
  FrameworkPopularityMetric,
  FrameworkPopularityMetricId,
  FrameworkPopularityPoint,
  FrameworkPopularityResearch,
  FrameworkPopularitySeries,
} from '../../app/core/framework-popularity.models';
import { getResearchDatabaseConfig } from '../../config/research-database';

const RESEARCH_ROOT = join(process.cwd(), 'research', 'framework-popularity');
const FRAMEWORKS: FrameworkName[] = ['React', 'Angular', 'Vue'];

const NPM_PACKAGE_TO_FRAMEWORK: Record<string, FrameworkName> = {
  react: 'React',
  '@angular/core': 'Angular',
  vue: 'Vue',
};

const GITHUB_LEGACY_FILES: Record<FrameworkName, string> = {
  React: 'facebook_react-stars-history.csv',
  Angular: 'angular_angular-stars-history.csv',
  Vue: 'vuejs_core-stars-history.csv',
};

let cachedResearch: FrameworkPopularityResearch | undefined;

export async function getFrameworkPopularityResearch(): Promise<FrameworkPopularityResearch> {
  if (!cachedResearch) {
    const metrics = [buildGoogleTrendsMetric(), buildNpmMetric(), buildGithubStarsMetric()];
    const forecasts = loadForecasts();

    for (const metric of metrics) {
      metric.forecasts = forecasts.get(metric.id) ?? [];
    }

    cachedResearch = {
      generatedAt: getLatestDate(metrics),
      metrics,
      diagnostics: loadDiagnostics(),
      provenanceNotes: [
        'Google Trends values are monthly averages of the web-frameworks category (31) series collected by the research scripts.',
        'npm values are monthly package downloads for react, @angular/core, and vue.',
        'GitHub values are privacy-safe daily star-history bucket counts from GitHub\'s REST endpoint, summed into completed calendar months; historical buckets may be restated after unstars or account removals.',
        'The official GitHub history is reconciled against the former archived histories only over their common date range; the legacy files are not used as production inputs.',
      ],
    };
  }

  if (!getResearchDatabaseConfig().readsEnabled) {
    return cachedResearch;
  }

  const [githubStarsRows, googleTrendsRows, npmRows] = await Promise.all([
    listGitHubStarsMonthly(),
    listGoogleTrendsMonthly(),
    listNpmMonthlyDownloads(),
  ]);

  if (githubStarsRows.length === 0 && googleTrendsRows.length === 0 && npmRows.length === 0) {
    return cachedResearch;
  }

  const metrics = cachedResearch.metrics.map((metric) => {
    if (metric.id === 'google-trends' && googleTrendsRows.length > 0) {
      return buildGoogleTrendsMetricFromDatabase(metric, googleTrendsRows);
    }
    if (metric.id === 'npm-downloads' && npmRows.length > 0) {
      return buildNpmMetricFromDatabase(metric, npmRows);
    }
    if (metric.id === 'github-stars' && githubStarsRows.length > 0) {
      return buildGithubStarsMetricFromDatabase(metric, githubStarsRows);
    }
    return metric;
  });

  return {
    ...cachedResearch,
    generatedAt: getLatestDate(metrics),
    metrics,
  };
}

function buildGithubStarsMetricFromDatabase(
  generatedMetric: FrameworkPopularityMetric,
  rows: GitHubStarsMonthlyDatabaseRow[],
): FrameworkPopularityMetric {
  const pointsByFramework = createPointBuckets();
  for (const row of rows) {
    if (!isCompletedCalendarMonth(row.period)) {
      continue;
    }
    pointsByFramework[row.framework].push({
      date: monthKey(row.period),
      value: row.newStars,
    });
  }

  return {
    ...generatedMetric,
    sourceLabel: 'GitHub REST API · scheduled database ingestion',
    series: seriesFromBuckets(pointsByFramework),
  };
}

function buildGoogleTrendsMetricFromDatabase(
  archivedMetric: FrameworkPopularityMetric,
  rows: GoogleTrendsMonthlyDatabaseRow[],
): FrameworkPopularityMetric {
  const pointsByFramework = createPointBuckets();

  for (const row of rows) {
    if (!isCompletedCalendarMonth(row.period)) {
      continue;
    }
    pointsByFramework[row.framework].push({
      date: monthKey(row.period),
      value: row.interest,
    });
  }

  return {
    ...archivedMetric,
    sourceLabel: 'Google Trends · scheduled database ingestion · category 31',
    series: seriesFromBuckets(pointsByFramework),
  };
}

function buildGoogleTrendsMetric(): FrameworkPopularityMetric {
  const rows = readCsv('ts_out/gt_ui_5y_monthly_cat31.csv');

  return {
    id: 'google-trends',
    label: 'Google Trends',
    unit: 'interest index',
    sourceLabel: 'Google Trends · category 31',
    description: 'Relative search interest for React, Angular, and Vue, averaged by month.',
    methodology: 'The research pipeline collects weekly interest, then aggregates it to monthly means on Google\'s 0–100 scale.',
    forecasts: [],
    series: FRAMEWORKS.map((framework) => ({
      framework,
      points: rows
        .filter((row) => isCompletedCalendarMonth(requireCell(row, 'date')))
        .map((row) => ({
          date: monthKey(requireCell(row, 'date')),
          value: parseNumber(requireCell(row, framework)),
        })),
    })),
  };
}

function buildNpmMetric(): FrameworkPopularityMetric {
  const rows = readCsv('out/npm_downloads_monthly.csv');
  const pointsByFramework = createPointBuckets();

  for (const row of rows) {
    if (!isCompletedCalendarMonth(requireCell(row, 'period'))) {
      continue;
    }
    const framework = NPM_PACKAGE_TO_FRAMEWORK[requireCell(row, 'package')];

    if (!framework) {
      continue;
    }

    pointsByFramework[framework].push({
      date: monthKey(requireCell(row, 'period')),
      value: parseNumber(requireCell(row, 'downloads')),
    });
  }

  return {
    id: 'npm-downloads',
    label: 'npm downloads',
    unit: 'downloads / month',
    sourceLabel: 'npm downloads API',
    description: 'Monthly downloads of each framework\'s primary npm package.',
    methodology: 'Daily package downloads are collected, completed with zero-value dates, and summed into calendar months.',
    forecasts: [],
    series: seriesFromBuckets(pointsByFramework),
  };
}

function buildNpmMetricFromDatabase(
  archivedMetric: FrameworkPopularityMetric,
  rows: NpmMonthlyDatabaseRow[],
): FrameworkPopularityMetric {
  const pointsByFramework = createPointBuckets();

  for (const row of rows) {
    if (!isCompletedCalendarMonth(row.period)) {
      continue;
    }
    const framework = NPM_PACKAGE_TO_FRAMEWORK[row.package];

    if (!framework) {
      continue;
    }

    pointsByFramework[framework].push({
      date: monthKey(row.period),
      value: row.downloads,
    });
  }

  return {
    ...archivedMetric,
    sourceLabel: 'npm downloads API · scheduled database ingestion',
    series: seriesFromBuckets(pointsByFramework),
  };
}

function buildGithubStarsMetric(): FrameworkPopularityMetric {
  const officialPath = join(RESEARCH_ROOT, 'out/github_stars_monthly.csv');
  if (!existsSync(officialPath)) {
    return buildLegacyGithubStarsMetric();
  }

  const rows = readCsv('out/github_stars_monthly.csv');
  const pointsByFramework = createPointBuckets();

  for (const row of rows) {
    if (!isCompletedCalendarMonth(requireCell(row, 'period'))) {
      continue;
    }
    const framework = requireCell(row, 'framework') as FrameworkName;
    if (!FRAMEWORKS.includes(framework)) {
      continue;
    }
    pointsByFramework[framework].push({
      date: monthKey(requireCell(row, 'period')),
      value: parseNumber(requireCell(row, 'new_stars')),
    });
  }

  return {
    id: 'github-stars',
    label: 'GitHub stars',
    unit: 'new stars / month',
    sourceLabel: 'GitHub REST API · repository star history',
    description: 'Monthly additions to the main React, Angular, and Vue repositories.',
    methodology: 'GitHub returns privacy-safe daily counts in weekly buckets. The pipeline validates those buckets and sums daily new stars into completed calendar months.',
    forecasts: [],
    series: seriesFromBuckets(pointsByFramework),
  };
}

function buildLegacyGithubStarsMetric(): FrameworkPopularityMetric {
  const pointsByFramework = createPointBuckets();

  for (const framework of FRAMEWORKS) {
    const rows = readCsv(join('git_stars', GITHUB_LEGACY_FILES[framework]));
    const totalsByMonth = new Map<string, number>();
    for (const row of rows) {
      const [day, month, year] = requireCell(row, 'date').split('-');
      if (!day || !month || !year) {
        throw new Error('Invalid legacy GitHub star date.');
      }
      const key = `${year}-${month}`;
      if (!isCompletedCalendarMonth(key)) {
        continue;
      }
      totalsByMonth.set(
        key,
        (totalsByMonth.get(key) ?? 0) + parseNumber(requireCell(row, 'day-stars')),
      );
    }
    pointsByFramework[framework] = [...totalsByMonth]
      .map(([date, value]) => ({ date, value }));
  }

  return {
    id: 'github-stars',
    label: 'GitHub stars',
    unit: 'new stars / month',
    sourceLabel: 'Legacy GitHub star histories · pending first official refresh',
    description: 'Monthly additions to the main React, Angular, and Vue repositories.',
    methodology: 'Temporary compatibility fallback until the first official GitHub star-history refresh is published.',
    forecasts: [],
    series: seriesFromBuckets(pointsByFramework),
  };
}

function loadForecasts(): Map<FrameworkPopularityMetricId, FrameworkForecastSeries[]> {
  const rows = readCsv('out/framework_popularity_forecasts.csv');
  const grouped = new Map<string, FrameworkForecastSeries>();

  for (const row of rows) {
    const metric = requireCell(row, 'metric') as FrameworkPopularityMetricId;
    const framework = requireCell(row, 'framework') as FrameworkName;
    const model = requireCell(row, 'model') as FrameworkForecastModel;
    const key = `${metric}:${framework}:${model}`;
    const existing = grouped.get(key) ?? {
      framework,
      model,
      isBest: requireCell(row, 'is_best') === 'TRUE',
      validationRmse: parseNumber(requireCell(row, 'validation_rmse')),
      points: [],
    };

    existing.points.push({
      date: monthKey(requireCell(row, 'date')),
      mean: parseNumber(requireCell(row, 'mean')),
      lo80: parseNumber(requireCell(row, 'lo80')),
      hi80: parseNumber(requireCell(row, 'hi80')),
      lo95: parseNumber(requireCell(row, 'lo95')),
      hi95: parseNumber(requireCell(row, 'hi95')),
    });
    grouped.set(key, existing);
  }

  const byMetric = new Map<FrameworkPopularityMetricId, FrameworkForecastSeries[]>();
  for (const [key, series] of grouped) {
    const metric = key.split(':')[0] as FrameworkPopularityMetricId;
    const existing = byMetric.get(metric) ?? [];
    existing.push(series);
    byMetric.set(metric, existing);
  }

  return byMetric;
}

function loadDiagnostics(): FrameworkPopularityDiagnostic[] {
  const sources: Array<[FrameworkPopularityMetricId, string]> = [
    ['google-trends', 'ts_out/forecast_RAV_monthly/ljung_box_summary.csv'],
    ['npm-downloads', 'ts_out/forecast_RAV_monthly_npm/ljung_box_summary_clean.csv'],
    ['github-stars', 'ts_out/forecast_RAV_monthly_github_stars/ljung_box_summary.csv'],
  ];

  return sources.flatMap(([metric, path]) =>
    readCsv(path).map((row) => ({
      metric,
      framework: requireCell(row, 'series') as FrameworkName,
      arimaPValue: parseNullableNumber(requireCell(row, 'lb_p_arima')),
      etsPValue: parseNullableNumber(requireCell(row, 'lb_p_ets')),
    })),
  );
}

function readCsv(relativePath: string): Array<Record<string, string>> {
  const content = readFileSync(join(RESEARCH_ROOT, relativePath), 'utf8').trim();
  const [headerLine, ...lines] = content.split(/\r?\n/);

  if (!headerLine) {
    return [];
  }

  const headers = headerLine.split(',');

  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function requireCell(row: Record<string, string>, key: string): string {
  const value = row[key];

  if (value === undefined) {
    throw new Error(`Missing ${key} in framework-popularity research data.`);
  }

  return value;
}

function parseNumber(value: string): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`Invalid framework-popularity number: ${value}`);
  }

  return number;
}

function parseNullableNumber(value: string): number | null {
  return value === 'NA' || value === '' ? null : parseNumber(value);
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

export function isCompletedCalendarMonth(value: string, today = new Date()): boolean {
  return monthKey(value) < today.toISOString().slice(0, 7);
}

function createPointBuckets(): Record<FrameworkName, FrameworkPopularityPoint[]> {
  return { React: [], Angular: [], Vue: [] };
}

function seriesFromBuckets(
  buckets: Record<FrameworkName, FrameworkPopularityPoint[]>,
): FrameworkPopularitySeries[] {
  return FRAMEWORKS.map((framework) => ({
    framework,
    points: buckets[framework].sort((left, right) => left.date.localeCompare(right.date)),
  }));
}

function getLatestDate(metrics: FrameworkPopularityMetric[]): string {
  return metrics
    .flatMap((metric) => metric.series.flatMap((series) => series.points.map((point) => point.date)))
    .sort()
    .at(-1) ?? 'unknown';
}
