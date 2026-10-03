import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const localEnvironment = {
  ...readEnvironmentFile('.env.local'),
  ...process.env,
};
const researchRoot = fileURLToPath(
  new URL('../research/framework-popularity/', import.meta.url),
);
const ingestionPort = localEnvironment.LOCAL_INGESTION_PORT ?? '8081';
const ingestionUrl = (localEnvironment.LOCAL_INGESTION_URL ?? `http://127.0.0.1:${ingestionPort}`)
  .replace(/\/+$/, '');
const apiRoot = `${ingestionUrl}/api/internal/v1/ingestions/github-stars`;
const sharedEnvironment = {
  ...localEnvironment,
  RESEARCH_INGESTION_ALLOW_UNAUTHENTICATED: 'true',
  RESEARCH_INGESTION_URL: ingestionUrl,
};

runRScript('jobs/collect_github_stars_ingestion.R', sharedEnvironment);
runRScript('jobs/publish_github_stars_ingestion.R', sharedEnvironment);

const checkpointResponse = await fetch(`${apiRoot}/checkpoint`);
if (!checkpointResponse.ok) {
  throw new Error(`Could not read local checkpoint: HTTP ${checkpointResponse.status}.`);
}
const checkpoint = await checkpointResponse.json();
console.log(`Local GitHub stars pipeline completed through ${checkpoint.latestDate ?? 'unknown'}.`);

function runRScript(script, environment) {
  const result = spawnSync('Rscript', [script], {
    cwd: researchRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}.`);
}

function readEnvironmentFile(path) {
  const environment = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    environment[key] = value;
  }
  return environment;
}
