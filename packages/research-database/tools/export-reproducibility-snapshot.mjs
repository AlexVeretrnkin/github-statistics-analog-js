import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { validateSeries } from '../../../tools/research-snapshot-validation.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const asOf = process.argv.find((arg) => arg.startsWith('--as-of='))?.split('=')[1];
if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)
  || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) {
  throw new Error('Pass an explicit valid --as-of=YYYY-MM-DD (only earlier complete months are exported).');
}
const local = process.argv.includes('--local');
let connection = process.env.DATABASE_URL;
if (local) {
  // Explicit local mode never honors an inherited cloud DATABASE_URL.
  const url = new URL('postgresql://127.0.0.1');
  url.port = process.env.LOCAL_POSTGRES_PORT ?? '5433';
  url.username = process.env.LOCAL_DATABASE_USER ?? 'research';
  url.password = process.env.LOCAL_DATABASE_PASSWORD ?? 'research-local-only';
  url.pathname = `/${process.env.LOCAL_DATABASE_NAME ?? 'research'}`;
  connection = url.toString();
}
if (!connection) throw new Error('DATABASE_URL is required unless explicit --local mode is selected.');
const before = `${asOf.slice(0, 7)}-01`;
const sql = postgres(connection, { max: 1, connect_timeout: 15, idle_timeout: 5 });
let snapshot;
try {
  snapshot = await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [context] = await tx`SELECT transaction_timestamp()::text AS captured_at,
      current_setting('transaction_read_only') AS read_only,
      current_setting('transaction_isolation') AS isolation`;
    const npmDaily = await tx`SELECT package, date::text, downloads::text, last_run_id::text
      FROM npm_download_daily WHERE date < ${before}::date ORDER BY package, date`;
    const npmMonthly = await tx`SELECT package, period::text, downloads::text, last_run_id::text
      FROM npm_download_monthly WHERE period < ${before}::date ORDER BY package, period`;
    const githubDaily = await tx`SELECT repository, framework, date::text, new_stars::text, last_run_id::text
      FROM github_star_daily WHERE date < ${before}::date ORDER BY repository, date`;
    const githubMonthly = await tx`SELECT repository, framework, period::text, new_stars::text, last_run_id::text
      FROM github_star_monthly WHERE period < ${before}::date ORDER BY repository, period`;
    const ids = [...new Set([...npmDaily, ...npmMonthly, ...githubDaily, ...githubMonthly].map(r => r.last_run_id))];
    if (!npmMonthly.length || !githubMonthly.length) throw new Error('Both monthly datasets must be nonempty.');
    // Only allowlisted provenance fields are exported, never arbitrary metadata or errors.
    const runs = await tx`SELECT id::text, source, schema_version, status::text, git_sha,
      source_data_through::text, started_at::text, finished_at::text,
      metadata->>'kind' AS kind
      FROM research_pipeline_runs WHERE id IN ${tx(ids)} ORDER BY source, started_at, id`;
    if (runs.some(r => r.git_sha === 'local-smoke' || /smoke|synthetic/i.test(r.kind ?? ''))) {
      throw new Error('Synthetic smoke-test data is referenced by this snapshot; refusing a research export.');
    }
    if (runs.length !== ids.length || runs.some(r => r.status !== 'committed')) {
      throw new Error('Snapshot references missing or uncommitted ingestion runs.');
    }
    const checks = [
      validateSeries(npmDaily, npmMonthly, 'package', 'downloads', ['@angular/core', 'react', 'vue'], before),
      validateSeries(githubDaily, githubMonthly, 'repository', 'new_stars', ['angular/angular', 'facebook/react', 'vuejs/core'], before),
    ];
    return { context, npmDaily, npmMonthly, githubDaily, githubMonthly, runs, checks };
  });
} catch (error) {
  // Do not print connection strings, database error queries, or parameters.
  console.error(`Read-only snapshot failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
if (!snapshot) process.exit(1);

const destination = resolve(root, 'output/reproducibility', `snapshot-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(destination, { recursive: true });
const files = [];
function record(path, role) {
  const bytes = readFileSync(resolve(destination, path));
  files.push({ path, role, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
function save(path, content, role) {
  writeFileSync(resolve(destination, path), content, { flag: 'wx' });
  record(path, role);
}
function csv(rows) {
  const fields = Object.keys(rows[0]);
  const cell = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return `${fields.join(',')}\n${rows.map(r => fields.map(k => cell(r[k])).join(',')).join('\n')}\n`;
}
for (const [name, rows] of Object.entries({ npm_downloads_daily: snapshot.npmDaily,
  npm_downloads_monthly: snapshot.npmMonthly, github_stars_daily: snapshot.githubDaily,
  github_stars_monthly: snapshot.githubMonthly })) {
  if (!rows.length) throw new Error(`${name} is empty.`);
  save(`${name}.csv`, csv(rows), 'canonical-observations');
}
save('ingestion-runs.json', `${JSON.stringify(snapshot.runs, null, 2)}\n`, 'allowlisted-provenance');
const preserved = {
  'archived-dashboard-forecasts.csv': 'research/framework-popularity/out/framework_popularity_forecasts.csv',
  'export_forecasts.R': 'research/framework-popularity/export_forecasts.R',
  'completed_months.R': 'research/framework-popularity/completed_months.R',
  'pnpm-lock.yaml': 'pnpm-lock.yaml',
  'renv.lock': 'research/framework-popularity/renv.lock',
  'DATA-DICTIONARY.md': 'docs/reproducibility-data-dictionary.md',
  'LICENSE': 'LICENSE',
  'LICENSE-SCOPE.md': 'LICENSE-SCOPE.md',
  'CITATION.cff': 'CITATION.cff',
};
for (const [name, source] of Object.entries(preserved)) {
  copyFileSync(resolve(root, source), resolve(destination, name));
  record(name, name === 'archived-dashboard-forecasts.csv' ? 'pre-existing-forecast-not-refitted' : 'supporting-file');
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
  { cwd: root, encoding: 'utf8' }).trim());
const manifest = {
  schemaVersion: 1, title: 'Web framework indicators: completed-month database snapshot',
  status: 'local-unpublished-candidate', persistentIdentifier: null,
  asOf, completedMonthBefore: before, transaction: snapshot.context,
  validation: snapshot.checks,
  source: local ? 'local-compose-PostgreSQL-database' : 'explicitly-configured-PostgreSQL-database',
  repository: 'https://github.com/AlexVeretrnkin/github-statistics-analog-js',
  gitCommit: commit, workingTreeDirty: dirty,
  softwareLicense: 'MIT', dataLicense: 'not-assigned-pending-source-rights-review',
  articleResultsReproduced: false, archivedForecastMatchesSnapshot: 'not-verified',
  caveats: [
    'Captured now, not a reconstruction of the database at the original forecast origin.',
    'GitHub star-history buckets may be revised by the upstream provider.',
    'Pre-existing forecasts are preserved byte-for-byte, not fitted to this snapshot.',
    'A dirty working tree is not represented completely by the git commit identifier.',
    'Google Trends is outside the article snapshot; the current general forecast script still expects it.',
  ],
  files,
};
writeFileSync(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(`Snapshot saved without database writes or forecast refitting: ${destination}`);
