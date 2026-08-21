import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  listNpmMonthlyDownloads,
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

const GITHUB_FILES: Record<FrameworkName, string> = {
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
        'GitHub stars in the current chart are monthly additions aggregated from the archived daily histories. Their upstream origin remains for a later provenance review.',
        'New first-party GitHub totals are stored as monthly snapshots. Net growth is derived only between real snapshots and is not spliced across the legacy-data gap.',
      ],
    };
  }

  if (!getResearchDatabaseConfig().readsEnabled) {
    return cachedResearch;
  }

  const npmRows = await listNpmMonthlyDownloads();

  if (npmRows.length === 0) {
    return cachedResearch;
  }

  const metrics = cachedResearch.metrics.map((metric) =>
    metric.id === 'npm-downloads'
      ? buildNpmMetricFromDatabase(metric, npmRows)
      : metric,
  );

  return {
    ...cachedResearch,
    generatedAt: getLatestDate(metrics),
    metrics,
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
      points: rows.map((row) => ({
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
  const pointsByFramework = createPointBuckets();

  for (const framework of FRAMEWORKS) {
    const rows = readCsv(join('git_stars', GITHUB_FILES[framework]));
    const totalsByMonth = new Map<string, number>();

    for (const row of rows) {
      const dateParts = requireCell(row, 'date').split('-');
      const month = `${dateParts[2]}-${dateParts[1]}`;
      totalsByMonth.set(
        month,
        (totalsByMonth.get(month) ?? 0) + parseNumber(requireCell(row, 'day-stars')),
      );
    }

    pointsByFramework[framework] = [...totalsByMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({ date, value }));
  }

  return {
    id: 'github-stars',
    label: 'GitHub stars',
    unit: 'new stars / month',
    sourceLabel: 'Archived GitHub star histories',
    description: 'Monthly additions to the main React, Angular, and Vue repositories.',
    methodology: 'Daily star additions from the archived histories are summed by calendar month. Data-origin discussion is deferred.',
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
