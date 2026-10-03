import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  closeResearchDatabase,
  listGitHubStarsDailyForQuality,
  listGitHubStarsMonthlyForQuality,
} from '@github-statistics/research-database/quality';

const strict = process.argv.includes('--strict');
const jsonOutput = process.argv.includes('--json');
const researchRoot = process.env.RESEARCH_FRAMEWORK_ROOT
  ?? 'research/framework-popularity';
process.env.DATABASE_URL ||= localDatabaseUrl();
const repositories = {
  'angular/angular': join(researchRoot, 'git_stars/angular_angular-stars-history.csv'),
  'facebook/react': join(researchRoot, 'git_stars/facebook_react-stars-history.csv'),
  'vuejs/core': join(researchRoot, 'git_stars/vuejs_core-stars-history.csv'),
};

let databaseDaily;
let databaseMonthly;
try {
  [databaseDaily, databaseMonthly] = await Promise.all([
    listGitHubStarsDailyForQuality(),
    listGitHubStarsMonthlyForQuality(),
  ]);
} finally {
  await closeResearchDatabase();
}
const officialDaily = databaseDaily.map((row) => ({
  date: requireIsoDate(row.date),
  newStars: requireCount(row.newStars),
  repository: requireRepository(row.repository),
}));
const officialMonthly = databaseMonthly.map((row) => ({
  date: requireIsoDate(row.period),
  newStars: requireCount(row.newStars),
  repository: requireRepository(row.repository),
}));
const legacyDaily = Object.entries(repositories).flatMap(([repository, path]) =>
  readCsv(path).map((row) => ({
    date: dmyToIso(row.date),
    newStars: requireCount(row['day-stars']),
    repository,
  })),
);
const monthlyOverlap = buildComparableMonthlyRows(legacyDaily, officialDaily, officialMonthly);

const report = {
  daily: compareByRepository(legacyDaily, officialDaily),
  monthly: compareByRepository(monthlyOverlap.legacy, monthlyOverlap.official),
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport('Daily star-history counts', report.daily);
  printReport('Completed monthly star-history counts', report.monthly);
}

const differences = [report.daily, report.monthly]
  .flatMap((section) => section.repositories)
  .reduce((total, item) => total + item.missingOfficial + item.extraOfficial
    + item.valueMismatches + (item.comparedRows === 0 ? 1 : 0), 0);

if (strict && differences > 0) {
  console.error(`Strict reconciliation failed with ${differences} differences or coverage errors.`);
  process.exitCode = 1;
}

function compareByRepository(legacyRows, officialRows) {
  const names = [...new Set([
    ...legacyRows.map((row) => row.repository),
    ...officialRows.map((row) => row.repository),
  ])].sort();
  const results = names.map((repository) => {
    const legacy = legacyRows.filter((row) => row.repository === repository);
    const official = officialRows.filter((row) => row.repository === repository);
    const overlapStart = maxString(minDate(legacy), minDate(official));
    const overlapEnd = minString(maxDate(legacy), maxDate(official));

    if (!overlapStart || !overlapEnd || overlapStart > overlapEnd) {
      return emptyComparison(repository, legacy, official);
    }

    const legacyMap = rowsInRange(legacy, overlapStart, overlapEnd);
    const officialMap = rowsInRange(official, overlapStart, overlapEnd);
    const keys = [...new Set([...legacyMap.keys(), ...officialMap.keys()])].sort();
    const examples = [];
    let exactMatches = 0;
    let extraOfficial = 0;
    let maxAbsoluteDifference = 0;
    let missingOfficial = 0;
    let totalAbsoluteDifference = 0;
    let valueMismatches = 0;

    for (const key of keys) {
      const legacyValue = legacyMap.get(key);
      const officialValue = officialMap.get(key);
      if (officialValue === undefined) {
        missingOfficial += 1;
        examples.push({ date: key, difference: null, legacy: legacyValue, official: null });
      } else if (legacyValue === undefined) {
        extraOfficial += 1;
        examples.push({ date: key, difference: null, legacy: null, official: officialValue });
      } else if (legacyValue !== officialValue) {
        const difference = officialValue - legacyValue;
        const absoluteDifference = Math.abs(difference);
        valueMismatches += 1;
        totalAbsoluteDifference += absoluteDifference;
        maxAbsoluteDifference = Math.max(maxAbsoluteDifference, absoluteDifference);
        examples.push({ date: key, difference, legacy: legacyValue, official: officialValue });
      } else {
        exactMatches += 1;
      }
    }

    examples.sort((left, right) =>
      Math.abs(right.difference ?? Number.MAX_SAFE_INTEGER)
      - Math.abs(left.difference ?? Number.MAX_SAFE_INTEGER));

    return {
      comparedRows: keys.length,
      exactMatches,
      examples: examples.slice(0, 5),
      extraOfficial,
      legacyCoverage: coverage(legacy),
      maxAbsoluteDifference,
      missingOfficial,
      officialCoverage: coverage(official),
      overlapEnd,
      overlapStart,
      repository,
      totalAbsoluteDifference,
      valueMismatches,
    };
  });

  return { legacyRows: legacyRows.length, officialRows: officialRows.length, repositories: results };
}

function emptyComparison(repository, legacy, official) {
  return {
    comparedRows: 0,
    exactMatches: 0,
    examples: [],
    extraOfficial: 0,
    legacyCoverage: coverage(legacy),
    maxAbsoluteDifference: 0,
    missingOfficial: 0,
    officialCoverage: coverage(official),
    overlapEnd: null,
    overlapStart: null,
    repository,
    totalAbsoluteDifference: 0,
    valueMismatches: 0,
  };
}

function printReport(title, report) {
  console.log(`\n${title}`);
  console.log(`Legacy rows: ${report.legacyRows}; official rows: ${report.officialRows}`);
  console.table(report.repositories.map((item) => ({
    repository: item.repository,
    legacy: item.legacyCoverage,
    official: item.officialCoverage,
    overlap: item.overlapStart ? `${item.overlapStart}..${item.overlapEnd}` : 'none',
    compared: item.comparedRows,
    exact: item.exactMatches,
    mismatched: item.valueMismatches,
    missingOfficial: item.missingOfficial,
    extraOfficial: item.extraOfficial,
    maxAbsDiff: item.maxAbsoluteDifference,
  })));

  for (const item of report.repositories) {
    if (item.examples.length > 0) {
      console.log(`${item.repository} example differences:`);
      console.table(item.examples);
    }
  }
}

function aggregateMonthly(rows) {
  const totals = new Map();
  for (const row of rows) {
    const date = `${row.date.slice(0, 7)}-01`;
    const key = `${row.repository}:${date}`;
    const existing = totals.get(key) ?? { date, newStars: 0, repository: row.repository };
    existing.newStars += row.newStars;
    totals.set(key, existing);
  }
  return [...totals.values()];
}

function buildComparableMonthlyRows(legacyDailyRows, officialDailyRows, officialMonthlyRows) {
  const legacy = [];
  const official = [];

  for (const repository of Object.keys(repositories)) {
    const legacyRepositoryRows = legacyDailyRows.filter((row) => row.repository === repository);
    const officialRepositoryRows = officialDailyRows.filter((row) => row.repository === repository);
    const overlapStart = maxString(minDate(legacyRepositoryRows), minDate(officialRepositoryRows));
    const overlapEnd = minString(maxDate(legacyRepositoryRows), maxDate(officialRepositoryRows));
    if (!overlapStart || !overlapEnd || overlapStart > overlapEnd) continue;

    let firstMonth = `${overlapStart.slice(0, 7)}-01`;
    if (!overlapStart.endsWith('-01')) firstMonth = shiftMonth(firstMonth, 1);
    let lastMonth = `${overlapEnd.slice(0, 7)}-01`;
    if (overlapEnd !== lastDayOfMonth(lastMonth)) lastMonth = shiftMonth(lastMonth, -1);
    if (firstMonth > lastMonth) continue;

    legacy.push(...aggregateMonthly(legacyRepositoryRows.filter((row) => {
      const month = `${row.date.slice(0, 7)}-01`;
      return month >= firstMonth && month <= lastMonth;
    })));
    official.push(...officialMonthlyRows.filter((row) =>
      row.repository === repository && row.date >= firstMonth && row.date <= lastMonth));
  }

  return { legacy, official };
}

function shiftMonth(value, offset) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

function lastDayOfMonth(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function readCsv(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  const [headerLine, ...lines] = content.split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function requireRepository(value) {
  if (!Object.hasOwn(repositories, value)) throw new Error(`Unexpected repository: ${value}`);
  return value;
}

function requireIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  return value;
}

function dmyToIso(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) throw new Error(`Invalid legacy date: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function requireCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid star count: ${value}`);
  return count;
}

function rowsInRange(rows, from, to) {
  return new Map(rows.filter((row) => row.date >= from && row.date <= to)
    .map((row) => [row.date, row.newStars]));
}

function coverage(rows) {
  if (rows.length === 0) return 'empty';
  return `${minDate(rows)}..${maxDate(rows)} (${rows.length})`;
}

function minDate(rows) {
  return rows.map((row) => row.date).sort()[0] ?? null;
}

function maxDate(rows) {
  return rows.map((row) => row.date).sort().at(-1) ?? null;
}

function maxString(left, right) {
  if (!left || !right) return null;
  return left > right ? left : right;
}

function minString(left, right) {
  if (!left || !right) return null;
  return left < right ? left : right;
}

function localDatabaseUrl() {
  const environment = readEnvironmentFile('.env.local');
  const user = environment.LOCAL_DATABASE_USER ?? 'research';
  const password = environment.LOCAL_DATABASE_PASSWORD ?? 'research-local-only';
  const port = environment.LOCAL_POSTGRES_PORT ?? '5433';
  const database = environment.LOCAL_DATABASE_NAME ?? 'research';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    + `@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

function readEnvironmentFile(path) {
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}
