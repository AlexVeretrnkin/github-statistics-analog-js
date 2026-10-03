import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  closeResearchDatabase,
  listGoogleTrendsMonthlyForQuality,
  listGoogleTrendsWeeklyForQuality,
} from '@github-statistics/research-database/quality';

const EXPECTED_FRAMEWORKS = ['Angular', 'React', 'Vue'];
const VALUE_EPSILON = 1e-9;
const strict = process.argv.includes('--strict');
const jsonOutput = process.argv.includes('--json');
const inputArgument = process.argv.find((argument) => argument.startsWith('--input='));
const inputPath = resolve(
  inputArgument?.slice('--input='.length)
    ?? process.env.RESEARCH_GOOGLE_TRENDS_INGESTION_FILE
    ?? 'research/framework-popularity/out/google_trends_ingestion.rds',
);

process.env.DATABASE_URL ||= localDatabaseUrl();

const payload = readIngestionPayload(inputPath);
const sourceWeekly = payload.rows.map(normalizeWeeklyRow);
const sourceMonthly = deriveCompletedMonthly(sourceWeekly, payload.completedMonthBefore);

let databaseWeekly;
let databaseMonthly;
try {
  [databaseWeekly, databaseMonthly] = await Promise.all([
    listGoogleTrendsWeeklyForQuality(),
    listGoogleTrendsMonthlyForQuality(),
  ]);
} finally {
  await closeResearchDatabase();
}

const invariants = validatePayload(payload, sourceWeekly);
const report = {
  input: {
    completedMonthBefore: payload.completedMonthBefore,
    path: inputPath,
    schemaVersion: payload.schemaVersion,
    sourceDataThrough: payload.sourceDataThrough,
  },
  invariants,
  monthly: compareByFramework(sourceMonthly, databaseMonthly, 'period'),
  weekly: compareByFramework(sourceWeekly, databaseWeekly, 'date'),
};

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Input: ${inputPath}`);
  console.log(
    `Source through ${payload.sourceDataThrough}; completed months before `
      + payload.completedMonthBefore,
  );
  printInvariants(invariants);
  printReport('Weekly observations', report.weekly);
  printReport('Derived monthly averages', report.monthly);
}

const differences = [report.weekly, report.monthly]
  .flatMap((section) => section.frameworks)
  .reduce((total, item) =>
    total + item.missingInDatabase + item.extraInDatabase + item.valueMismatches,
  0);
const failures = differences + invariants.filter((item) => !item.ok).length;

if (strict && failures > 0) {
  console.error(`Strict Google Trends reconciliation failed with ${failures} differences.`);
  process.exitCode = 1;
}

function readIngestionPayload(path) {
  const inspector = resolve(
    'research/framework-popularity/jobs/inspect_google_trends_ingestion.R',
  );
  const result = spawnSync('Rscript', [inspector, path], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `RDS inspector exited with status ${result.status}.`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`RDS inspector returned invalid JSON: ${error.message}`);
  }
}

function normalizeWeeklyRow(row) {
  const interest = Number(row.interest);
  if (!EXPECTED_FRAMEWORKS.includes(row.framework)
      || !isIsoDate(row.date)
      || !Number.isFinite(interest)) {
    throw new Error(`Invalid Google Trends ingestion row: ${JSON.stringify(row)}`);
  }
  return { date: row.date, framework: row.framework, interest };
}

function deriveCompletedMonthly(rows, completedMonthBefore) {
  if (!/^\d{4}-\d{2}-01$/.test(completedMonthBefore)) {
    throw new Error(`Invalid completed-month boundary: ${completedMonthBefore}`);
  }

  const groups = new Map();
  for (const row of rows.filter((item) => item.date < completedMonthBefore)) {
    const period = `${row.date.slice(0, 7)}-01`;
    const key = `${row.framework}\0${period}`;
    const values = groups.get(key) ?? { framework: row.framework, period, sum: 0, count: 0 };
    values.sum += row.interest;
    values.count += 1;
    groups.set(key, values);
  }

  return [...groups.values()].map((group) => ({
    framework: group.framework,
    interest: group.sum / group.count,
    period: group.period,
  }));
}

function validatePayload(payload, rows) {
  const frameworks = [...new Set(rows.map((row) => row.framework))].sort();
  const datesByFramework = Object.fromEntries(EXPECTED_FRAMEWORKS.map((framework) => [
    framework,
    rows.filter((row) => row.framework === framework).map((row) => row.date).sort(),
  ]));
  const counts = Object.values(datesByFramework).map((dates) => dates.length);
  const dateSignatures = Object.values(datesByFramework).map((dates) => dates.join(','));
  const maximumDate = rows.map((row) => row.date).sort().at(-1) ?? null;
  const uniqueKeys = new Set(rows.map((row) => `${row.framework}\0${row.date}`));

  return [
    {
      check: 'schema version is 1',
      ok: payload.schemaVersion === 1,
      value: payload.schemaVersion,
    },
    {
      check: 'frameworks are exactly Angular, React, and Vue',
      ok: JSON.stringify(frameworks) === JSON.stringify(EXPECTED_FRAMEWORKS),
      value: frameworks.join(', '),
    },
    {
      check: 'each framework has at least 250 weekly rows',
      ok: counts.length === 3 && counts.every((count) => count >= 250),
      value: counts.join(', '),
    },
    {
      check: 'all frameworks have identical weekly dates',
      ok: new Set(dateSignatures).size === 1,
      value: `${new Set(dateSignatures).size} distinct date windows`,
    },
    {
      check: 'weekly framework/date keys are unique',
      ok: uniqueKeys.size === rows.length,
      value: `${uniqueKeys.size} unique / ${rows.length} rows`,
    },
    {
      check: 'sourceDataThrough equals the final weekly date',
      ok: payload.sourceDataThrough === maximumDate,
      value: `${payload.sourceDataThrough} / ${maximumDate}`,
    },
    {
      check: 'all interest values are within Google\'s 0-100 scale',
      ok: rows.every((row) => row.interest >= 0 && row.interest <= 100),
      value: valueRange(rows),
    },
  ];
}

function compareByFramework(sourceRows, databaseRows, dateField) {
  const frameworks = [...new Set([
    ...sourceRows.map((row) => row.framework),
    ...databaseRows.map((row) => row.framework),
  ])].sort();

  return {
    databaseRows: databaseRows.length,
    frameworks: frameworks.map((framework) => compareFramework(
      framework,
      sourceRows.filter((row) => row.framework === framework),
      databaseRows.filter((row) => row.framework === framework),
      dateField,
    )),
    sourceRows: sourceRows.length,
  };
}

function compareFramework(framework, sourceRows, databaseRows, dateField) {
  const source = new Map(sourceRows.map((row) => [row[dateField], row.interest]));
  const database = new Map(databaseRows.map((row) => [row[dateField], row.interest]));
  const keys = [...new Set([...source.keys(), ...database.keys()])].sort();
  const examples = [];
  let exactMatches = 0;
  let extraInDatabase = 0;
  let maxAbsoluteDifference = 0;
  let missingInDatabase = 0;
  let valueMismatches = 0;

  for (const key of keys) {
    const sourceValue = source.get(key);
    const databaseValue = database.get(key);
    if (databaseValue === undefined) {
      missingInDatabase += 1;
      examples.push({ database: null, difference: null, key, source: sourceValue });
    } else if (sourceValue === undefined) {
      extraInDatabase += 1;
      examples.push({ database: databaseValue, difference: null, key, source: null });
    } else {
      const difference = databaseValue - sourceValue;
      const absoluteDifference = Math.abs(difference);
      if (absoluteDifference > VALUE_EPSILON) {
        valueMismatches += 1;
        maxAbsoluteDifference = Math.max(maxAbsoluteDifference, absoluteDifference);
        examples.push({ database: databaseValue, difference, key, source: sourceValue });
      } else {
        exactMatches += 1;
      }
    }
  }

  examples.sort((left, right) =>
    Math.abs(right.difference ?? Number.MAX_SAFE_INTEGER)
      - Math.abs(left.difference ?? Number.MAX_SAFE_INTEGER));

  return {
    databaseCoverage: coverage(databaseRows, dateField),
    exactMatches,
    examples: examples.slice(0, 5),
    extraInDatabase,
    framework,
    maxAbsoluteDifference,
    missingInDatabase,
    sourceCoverage: coverage(sourceRows, dateField),
    valueMismatches,
  };
}

function printInvariants(invariants) {
  console.log('\nPayload validation');
  console.table(invariants.map((item) => ({
    check: item.check,
    result: item.ok ? 'ok' : 'FAILED',
    value: item.value,
  })));
}

function printReport(title, report) {
  console.log(`\n${title}`);
  console.log(`Source rows: ${report.sourceRows}; database rows: ${report.databaseRows}`);
  console.table(report.frameworks.map((item) => ({
    database: item.databaseCoverage,
    exact: item.exactMatches,
    extraDb: item.extraInDatabase,
    framework: item.framework,
    maxAbsDiff: item.maxAbsoluteDifference,
    mismatched: item.valueMismatches,
    missingDb: item.missingInDatabase,
    source: item.sourceCoverage,
  })));
  for (const item of report.frameworks) {
    if (item.examples.length > 0) {
      console.log(`${item.framework} example differences:`);
      console.table(item.examples);
    }
  }
}

function coverage(rows, dateField) {
  if (rows.length === 0) return 'empty';
  const dates = rows.map((row) => row[dateField]).sort();
  return `${dates[0]}..${dates.at(-1)} (${rows.length})`;
}

function valueRange(rows) {
  if (rows.length === 0) return 'empty';
  const values = rows.map((row) => row.interest);
  return `${Math.min(...values)}..${Math.max(...values)}`;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}
