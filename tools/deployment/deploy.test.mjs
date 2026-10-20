import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trafficAllocation } from './deploy.mjs';

test('rollback pins resolved revisions and preserves split traffic without tags', () => {
  assert.equal(trafficAllocation({ status: { traffic: [
    { latestRevision: true, revisionName: 'release-2', percent: 70 },
    { revisionName: 'release-1', percent: 30 },
    { revisionName: 'release-3', tag: 'candidate' },
  ] } }), 'release-2=70,release-1=30');
});
test('refuse deployment when rollback traffic cannot be captured', () => {
  assert.throws(() => trafficAllocation({ status: { traffic: [{ latestRevision: true, percent: 100 }] } }));
  assert.throws(() => trafficAllocation({ status: { traffic: [] } }));
});

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

for (const scenario of ['success', 'migration-failure', 'candidate-failure', 'promotion-failure']) {
  test(`release orchestration: ${scenario}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deployment-test-'));
    const server = createServer((request, response) => {
      const fail = (scenario === 'candidate-failure' && request.url.startsWith('/candidate/')) ||
        (scenario === 'promotion-failure' && !request.url.startsWith('/candidate/'));
      response.statusCode = fail ? 500 : 200;
      response.end(request.url.endsWith('/framework-popularity') ? '<html>dashboard</html>' : '{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const fake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.FAKE_LOG;
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'auth') { console.log('test-token'); process.exit(0); }
if (args[1] === 'jobs' && args[2] === 'execute' && process.env.SCENARIO === 'migration-failure') process.exit(1);
if (args[1] === 'services' && args[2] === 'describe') {
 const name = args[3];
 const deployed = previous.some(a => a[1] === 'deploy' && a[2] === name);
 console.log(JSON.stringify({ status: { url: process.env.FAKE_URL, traffic: [
   { revisionName: name + '-old', percent: 100, latestRevision: true },
   ...(deployed ? [{ revisionName: name + '-new', tag: 'candidate', url: process.env.FAKE_URL + '/candidate' }] : [])
 ] } }));
}
`;
    try {
      await writeFile(join(dir, 'gcloud'), fake, { mode: 0o755 });
      const exitCode = await new Promise((resolveExit, reject) => {
        const child = spawn(process.execPath, [resolve('tools/deployment/deploy.mjs')], {
          cwd: dir, stdio: 'ignore', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
            GCP_PROJECT: 'test', GCP_REGION: 'test', GCP_DEPLOY_SERVICE_ACCOUNT: 'test@example.com',
            GITHUB_SHA: 'a'.repeat(40), WEB_IMAGE: `web@sha256:${'a'.repeat(64)}`,
            INGESTION_IMAGE: `ingestion@sha256:${'b'.repeat(64)}`,
            FAKE_LOG: join(dir, 'calls.jsonl'), FAKE_URL: url, SCENARIO: scenario,
          },
        });
        child.once('error', reject); child.once('exit', resolveExit);
      });
      const calls = (await readFile(join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      const traffic = calls.filter(a => a[2] === 'update-traffic');
      const report = JSON.parse(await readFile(join(dir, 'output/deployment.json'), 'utf8'));
      assert.equal(exitCode, scenario === 'success' ? 0 : 1);
      assert.equal(report.status, scenario === 'success' ? 'passed' : 'failed');
      assert.equal(traffic.length, scenario === 'success' ? 2 : scenario === 'promotion-failure' ? 4 : 0);
      if (scenario === 'migration-failure') assert.equal(calls.some(a => a[1] === 'deploy'), false);
      if (scenario === 'promotion-failure') {
        assert.ok(traffic.slice(-2).every(a => a[a.indexOf('--to-revisions') + 1].endsWith('-old=100')));
        assert.deepEqual(report.rollbackErrors, []);
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });
}
