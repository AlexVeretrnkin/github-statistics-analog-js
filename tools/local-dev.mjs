import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const localEnvironment = {
  ...readEnvironmentFile('.env.local'),
  ...process.env,
};
const databaseName = localEnvironment.LOCAL_DATABASE_NAME ?? 'research';
const databaseUser = localEnvironment.LOCAL_DATABASE_USER ?? 'research';
const databasePassword = localEnvironment.LOCAL_DATABASE_PASSWORD ?? 'research-local-only';
const postgresPort = localEnvironment.LOCAL_POSTGRES_PORT ?? '5433';
const ingestionPort = localEnvironment.LOCAL_INGESTION_PORT ?? '8081';
const webPort = localEnvironment.LOCAL_WEB_PORT ?? '8080';
const databaseUrl = [
  'postgresql://',
  encodeURIComponent(databaseUser),
  ':',
  encodeURIComponent(databasePassword),
  '@127.0.0.1:',
  postgresPort,
  '/',
  encodeURIComponent(databaseName),
].join('');

const postgresIsCached = spawnSync(
  'docker',
  ['image', 'inspect', 'postgres:18-alpine'],
  { stdio: 'ignore' },
).status === 0;
const composeArguments = [
  'compose',
  '--env-file',
  '.env.local',
  '-f',
  'compose.yaml',
  'up',
  '--detach',
];

if (postgresIsCached) {
  composeArguments.push('--pull', 'never');
}
composeArguments.push('postgres');
runChecked('docker', composeArguments);
await waitForPostgres();
runChecked('pnpm', ['run', 'build:ingestion']);

const ingestion = spawn('node', ['apps/ingestion-api/dist/index.js'], {
  env: { ...localEnvironment, DATABASE_URL: databaseUrl, PORT: ingestionPort },
  stdio: 'inherit',
});

await waitForHealth(`http://127.0.0.1:${ingestionPort}/healthz`, ingestion);

const web = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', webPort], {
  env: {
    ...localEnvironment,
    DATABASE_URL: databaseUrl,
    FRAMEWORK_RESEARCH_DB_READS: 'true',
  },
  stdio: 'inherit',
});

console.log(`Local web:       http://127.0.0.1:${webPort}`);
console.log(`Local ingestion: http://127.0.0.1:${ingestionPort}`);
console.log('Run `pnpm local:smoke` in another terminal to publish deterministic data.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

ingestion.once('exit', (code) => stop(undefined, code));
web.once('exit', (code) => stop(undefined, code));

let stopping = false;
function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  ingestion.kill(signal ?? 'SIGTERM');
  web.kill(signal ?? 'SIGTERM');
  console.log('Application processes stopped. PostgreSQL remains available; use `pnpm local:down`.');
  process.exitCode = exitCode ?? 0;
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}.`);
  }
}

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Ingestion service exited with status ${child.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup and migrations are still in progress.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['inspect', '--format={{.State.Health.Status}}', 'github-statistics-postgres'],
      { encoding: 'utf8' },
    );

    if (result.status === 0 && result.stdout.trim() === 'healthy') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Timed out waiting for local PostgreSQL to become healthy.');
}

function readEnvironmentFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return separator < 0
            ? [line, '']
            : [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('Missing .env.local. Copy .env.local.example to .env.local.');
    }
    throw error;
  }
}
