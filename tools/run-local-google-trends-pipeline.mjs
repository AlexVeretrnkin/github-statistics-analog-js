import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const researchRoot = fileURLToPath(
  new URL('../research/framework-popularity/', import.meta.url),
);
const ingestionUrl = (process.env.LOCAL_INGESTION_URL ?? 'http://127.0.0.1:8081')
  .replace(/\/+$/, '');
const apiRoot = `${ingestionUrl}/api/internal/v1/ingestions/google-trends`;
const sharedEnvironment = {
  ...process.env,
  RESEARCH_INGESTION_ALLOW_UNAUTHENTICATED: 'true',
  RESEARCH_INGESTION_URL: ingestionUrl,
};

runRScript('jobs/collect_google_trends_ingestion.R', sharedEnvironment);
runRScript('jobs/publish_google_trends_ingestion.R', sharedEnvironment);

const checkpointResponse = await fetch(`${apiRoot}/checkpoint`);
if (!checkpointResponse.ok) {
  throw new Error(`Could not read local checkpoint: HTTP ${checkpointResponse.status}.`);
}
const checkpoint = await checkpointResponse.json();
console.log(`Local Google Trends pipeline completed through ${checkpoint.latestDate ?? 'unknown'}.`);

function runRScript(script, environment) {
  const result = spawnSync('Rscript', [script], {
    cwd: researchRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with status ${result.status}.`);
}
