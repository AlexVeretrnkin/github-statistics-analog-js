import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = `framework-repro-${randomUUID().slice(0, 12)}`;
const reportDir = resolve(root, 'output/reproducibility', project);
mkdirSync(reportDir, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !/^(COMPOSE_|DATABASE_URL$|GITHUB_TOKEN$|GH_TOKEN$|GEMINI_API_KEY$)/.test(name)));
const base = ['compose', '--env-file', '/dev/null', '-p', project,
  '-f', 'compose.reproducibility.yaml'];
const report = { project, startedAt: new Date().toISOString(), status: 'failed',
  scope: 'isolated Docker bootstrap and synthetic ingestion; no forecast fitting',
  cleanBuild: process.argv.includes('--no-cache'), commands: [] };
function docker(args, { check = true, compose = true } = {}) {
  console.log(`Verification: docker ${compose ? `${base.join(' ')} ` : ''}${args.join(' ')}`);
  const result = spawnSync('docker', [...(compose ? base : []), ...args], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 1200000,
    maxBuffer: 30 * 1024 * 1024,
  });
  const index = report.commands.length;
  writeFileSync(resolve(reportDir, `${index}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  report.commands.push({ args, compose, exitCode: result.status });
  if (result.stdout) console.log(result.stdout.slice(-10000));
  if (result.stderr) console.error(result.stderr.slice(-3000));
  if (check && (result.error || result.status !== 0)) {
    throw new Error(result.error?.message ?? `Docker command failed (${result.status}); see ${reportDir}/${index}.log`);
  }
  return result;
}
try {
  docker(['version', '--format', '{{json .}}'], { compose: false });
  docker(['build', ...(report.cleanBuild ? ['--no-cache'] : []), 'web', 'ingestion-api', 'migrate', 'verifier']);
  docker(['up', '-d', '--wait', '--wait-timeout', '180', 'web', 'ingestion-api', 'postgres']);
  const result = docker(['run', '--rm', '--no-deps', 'verifier']);
  report.verification = JSON.parse(result.stdout);
  // Record concrete local image IDs; floating registry tags alone are not an environment lock.
  docker(['images', '--format', 'json']);
  docker(['exec', '-T', 'postgres', 'psql', '-U', 'research', '-d', 'research', '-c',
    'SELECT count(*) AS applied_migrations FROM drizzle.__drizzle_migrations;']);
  report.status = 'passed';
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  docker(['logs', '--no-color', '--tail', '80'], { check: false });
} finally {
  // Only this randomly named test project's synthetic database is removed.
  const cleanup = docker(['down', '--volumes', '--remove-orphans'], { check: false });
  report.cleanupSucceeded = cleanup.status === 0;
  if (!report.cleanupSucceeded) { report.status = 'failed'; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Verification report: ${reportDir}/report.json`);
}
