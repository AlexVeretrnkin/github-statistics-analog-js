import { readFileSync } from 'node:fs';

import {
  closeResearchDatabase,
  listNpmDailyForQuality,
  listNpmMonthlyForQuality,
} from '@github-statistics/research-database/quality';

const strict = process.argv.includes('--strict');
const jsonOutput = process.argv.includes('--json');
process.env.DATABASE_URL ||= localDatabaseUrl();

let databaseDaily;
let databaseMonthly;
try {
  [databaseDaily, databaseMonthly] = await Promise.all([
    listNpmDailyForQuality(),
    listNpmMonthlyForQuality(),
  ]);
} finally {
  await closeResearchDatabase();
}

const archivedDaily = readCsv('research/framework-popularity/out/npm_downloads_daily.csv')
  .map((row) => normalizeRow(row, 'date'));
const archivedMonthly = readCsv('research/framework-popularity/out/npm_downloads_monthly.csv')
  .map((row) => normalizeRow(row, 'period'));
const report = {
  daily: compareByPackage(archivedDaily, databaseDaily, 'date'),
  monthly: compareByPackage(archivedMonthly, databaseMonthly, 'period'),
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport('Daily observations', report.daily);
  printReport('Monthly aggregates', report.monthly);
}

const differences = [report.daily, report.monthly]
  .flatMap((section) => section.packages)
  .reduce((total, item) =>
    total + item.missingInDatabase + item.extraInDatabase + item.valueMismatches
      + (item.comparedRows === 0 ? 1 : 0),
  0);

if (strict && differences > 0) {
  console.error(`Strict reconciliation failed with ${differences} differences or coverage errors.`);
  process.exitCode = 1;
}

function compareByPackage(archivedRows, databaseRows, dateField) {
  const packages = [...new Set([
    ...archivedRows.map((row) => row.package),
    ...databaseRows.map((row) => row.package),
  ])].sort();
  const results = packages.map((packageName) => {
    const archived = archivedRows.filter((row) => row.package === packageName);
    const database = databaseRows.filter((row) => row.package === packageName);
    const overlapStart = maxString(minDate(archived, dateField), minDate(database, dateField));
    const overlapEnd = minString(maxDate(archived, dateField), maxDate(database, dateField));

    if (!overlapStart || !overlapEnd || overlapStart > overlapEnd) {
      return {
        archivedCoverage: coverage(archived, dateField),
        comparedRows: 0,
        databaseCoverage: coverage(database, dateField),
        exactMatches: 0,
        examples: [],
        extraInDatabase: 0,
        maxAbsoluteDifference: 0,
        missingInDatabase: 0,
        overlapEnd: null,
        overlapStart: null,
        package: packageName,
        totalAbsoluteDifference: 0,
        valueMismatches: 0,
      };
    }

    const archivedMap = rowsInRange(archived, dateField, overlapStart, overlapEnd);
    const databaseMap = rowsInRange(database, dateField, overlapStart, overlapEnd);
    const keys = [...new Set([...archivedMap.keys(), ...databaseMap.keys()])].sort();
    const examples = [];
    let exactMatches = 0;
    let extraInDatabase = 0;
    let maxAbsoluteDifference = 0;
    let missingInDatabase = 0;
    let totalAbsoluteDifference = 0;
    let valueMismatches = 0;

    for (const key of keys) {
      const archivedValue = archivedMap.get(key);
      const databaseValue = databaseMap.get(key);

      if (databaseValue === undefined) {
        missingInDatabase += 1;
        examples.push({ archived: archivedValue, database: null, difference: null, key });
      } else if (archivedValue === undefined) {
        extraInDatabase += 1;
        examples.push({ archived: null, database: databaseValue, difference: null, key });
      } else if (archivedValue !== databaseValue) {
        const difference = databaseValue - archivedValue;
        const absoluteDifference = Math.abs(difference);
        valueMismatches += 1;
        totalAbsoluteDifference += absoluteDifference;
        maxAbsoluteDifference = Math.max(maxAbsoluteDifference, absoluteDifference);
        examples.push({ archived: archivedValue, database: databaseValue, difference, key });
      } else {
        exactMatches += 1;
      }
    }

    examples.sort((left, right) =>
      Math.abs(right.difference ?? Number.MAX_SAFE_INTEGER)
      - Math.abs(left.difference ?? Number.MAX_SAFE_INTEGER),
    );

    return {
      archivedCoverage: coverage(archived, dateField),
      comparedRows: keys.length,
      databaseCoverage: coverage(database, dateField),
      exactMatches,
      examples: examples.slice(0, 5),
      extraInDatabase,
      maxAbsoluteDifference,
      missingInDatabase,
      overlapEnd,
      overlapStart,
      package: packageName,
      totalAbsoluteDifference,
      valueMismatches,
    };
  });

  return {
    archivedRows: archivedRows.length,
    databaseRows: databaseRows.length,
    packages: results,
  };
}

function printReport(title, report) {
  console.log(`\n${title}`);
  console.log(`Archived rows: ${report.archivedRows}; database rows: ${report.databaseRows}`);
  console.table(report.packages.map((item) => ({
    package: item.package,
    archived: item.archivedCoverage,
    database: item.databaseCoverage,
    overlap: item.overlapStart ? `${item.overlapStart}..${item.overlapEnd}` : 'none',
    compared: item.comparedRows,
    exact: item.exactMatches,
    mismatched: item.valueMismatches,
    missingDb: item.missingInDatabase,
    extraDb: item.extraInDatabase,
    maxAbsDiff: item.maxAbsoluteDifference,
    comparable: item.comparedRows > 0 ? 'yes' : 'no',
  })));

  for (const item of report.packages) {
    if (item.examples.length > 0) {
      console.log(`${item.package} example differences:`);
      console.table(item.examples);
    }
  }
}

function readCsv(path) {
  const [headerLine, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function normalizeRow(row, dateField) {
  const downloads = Number(row.downloads);
  if (!row.package || !row[dateField] || !Number.isSafeInteger(downloads) || downloads < 0) {
    throw new Error(`Invalid archived npm row: ${JSON.stringify(row)}`);
  }
  return { [dateField]: row[dateField], downloads, package: row.package };
}

function rowsInRange(rows, dateField, from, to) {
  return new Map(rows
    .filter((row) => row[dateField] >= from && row[dateField] <= to)
    .map((row) => [row[dateField], row.downloads]));
}

function coverage(rows, dateField) {
  if (rows.length === 0) return 'empty';
  return `${minDate(rows, dateField)}..${maxDate(rows, dateField)} (${rows.length})`;
}

function minDate(rows, dateField) {
  return rows.map((row) => row[dateField]).sort()[0] ?? null;
}

function maxDate(rows, dateField) {
  return rows.map((row) => row[dateField]).sort().at(-1) ?? null;
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
