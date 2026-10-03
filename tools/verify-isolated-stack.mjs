import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// This test deliberately refuses the usual local/production endpoints.
assert.equal(process.env.LOCAL_INGESTION_URL, 'http://ingestion-api:8080');
assert.equal(process.env.LOCAL_WEB_URL, 'http://web:8080');
const sources = ['npm-downloads', 'google-trends', 'github-stars'];
async function checkpoint(source) {
  const response = await fetch(
    `${process.env.LOCAL_INGESTION_URL}/api/internal/v1/ingestions/${source}/checkpoint`,
    { signal: AbortSignal.timeout(15000), headers: { connection: 'close' } },
  );
  assert.equal(response.status, 200);
  return response.json();
}
for (const source of sources) {
  assert.equal((await checkpoint(source)).latestDate, null, `${source}: database must be empty`);
}
const smoke = JSON.parse(execFileSync(process.execPath, ['local-ingestion-smoke.mjs'], {
  encoding: 'utf8', timeout: 120000,
}));
assert.equal(smoke.webStatus, 200);
assert.equal(smoke.rowsPrepared, 93);
assert.equal(smoke.githubStarsRowsPrepared, 228);
assert.equal(smoke.trendsRowsPrepared, 780);
for (const source of sources) {
  assert.ok((await checkpoint(source)).latestDate, `${source}: committed data not found`);
}
assert.equal((await checkpoint('npm-downloads')).latestDate, '2015-01-31');
assert.equal((await checkpoint('github-stars')).latestCompletedMonth, '2026-01-01');
console.log(JSON.stringify({
  status: 'passed',
  scope: 'fresh-database-migrations-and-synthetic-ingestion; NOT article forecast reproduction',
  ...smoke,
}, null, 2));
