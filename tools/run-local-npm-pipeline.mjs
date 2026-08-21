import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const researchRoot = fileURLToPath(
  new URL('../research/framework-popularity/', import.meta.url),
);
const ingestionUrl = (process.env.LOCAL_INGESTION_URL ?? 'http://127.0.0.1:8081')
  .replace(/\/+$/, '');
const checkpointResponse = await fetch(
  `${ingestionUrl}/api/internal/v1/ingestions/npm-downloads/checkpoint`,
);

if (!checkpointResponse.ok) {
  throw new Error(`Could not read local checkpoint: HTTP ${checkpointResponse.status}.`);
}

const checkpoint = await checkpointResponse.json();
const sharedEnvironment = {
  ...process.env,
  RESEARCH_INGESTION_ALLOW_UNAUTHENTICATED: 'true',
  RESEARCH_INGESTION_URL: ingestionUrl,
  RESEARCH_NPM_LATEST_DATE: checkpoint.latestDate ?? '',
};

runRScript('jobs/collect_npm_ingestion.R', sharedEnvironment);
runRScript('jobs/publish_npm_ingestion.R', sharedEnvironment);

console.log(`Local npm pipeline completed through ${await latestDate()}.`);

function runRScript(script, environment) {
  const result = spawnSync('Rscript', [script], {
    cwd: researchRoot,
    env: environment,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${script} exited with status ${result.status}.`);
  }
}

async function latestDate() {
  const response = await fetch(
    `${ingestionUrl}/api/internal/v1/ingestions/npm-downloads/checkpoint`,
  );
  const value = await response.json();
  return value.latestDate ?? 'unknown';
}
