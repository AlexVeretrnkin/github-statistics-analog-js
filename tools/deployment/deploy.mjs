import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function trafficAllocation(service) {
  const allocation = new Map();
  for (const traffic of service.status.traffic ?? []) {
    if (traffic.percent > 0) {
      if (!traffic.revisionName) throw new Error('Cannot resolve existing traffic revision');
      allocation.set(traffic.revisionName, (allocation.get(traffic.revisionName) ?? 0) + traffic.percent);
    }
  }
  if ([...allocation.values()].reduce((a, b) => a + b, 0) !== 100) {
    throw new Error('Expected existing production traffic to total 100%');
  }
  return [...allocation].map(([revision, percent]) => `${revision}=${percent}`).join(',');
}

async function deploy() {
  for (const key of ['GCP_PROJECT', 'GCP_REGION', 'GCP_DEPLOY_SERVICE_ACCOUNT', 'GITHUB_SHA', 'WEB_IMAGE', 'INGESTION_IMAGE']) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  for (const key of ['WEB_IMAGE', 'INGESTION_IMAGE']) {
    if (!/@sha256:[a-f0-9]{64}$/.test(process.env[key])) throw new Error(`${key} must use a digest`);
  }
  const common = ['--project', process.env.GCP_PROJECT, '--region', process.env.GCP_REGION, '--quiet'];
  const gcloud = (...args) => execFileSync('gcloud', [...args, ...common], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const describe = name => JSON.parse(gcloud('run', 'services', 'describe', name, '--format=json'));
  const services = [
    { name: 'github-statistics-ingestion', image: process.env.INGESTION_IMAGE, private: true },
    { name: 'github-statistics-analog-js', image: process.env.WEB_IMAGE, private: false },
  ];
  const report = { commit: process.env.GITHUB_SHA, status: 'started', services };
  mkdirSync('output', { recursive: true });
  const save = () => writeFileSync('output/deployment.json', JSON.stringify(report, null, 2) + '\n');
  // Resolve LATEST to concrete revisions before creating any new revisions.
  for (const service of services) {
    const existing = describe(service.name);
    service.previousTraffic = trafficAllocation(existing);
    service.url = existing.status.url;
  }
  save();
  let promotionStarted = false;
  try {
    gcloud('run', 'jobs', 'deploy', 'github-statistics-migrate',
      '--image', process.env.INGESTION_IMAGE,
      '--service-account', 'github-ingestion-runtime@uni-rnd.iam.gserviceaccount.com',
      '--command', 'node', '--args', 'packages/research-database/dist/migrate.js',
      '--set-secrets', 'DATABASE_URL=neon-database-url-ingestion:1',
      '--tasks', '1', '--parallelism', '1', '--max-retries', '0', '--task-timeout', '300s');
    gcloud('run', 'jobs', 'execute', 'github-statistics-migrate', '--wait');
    for (const service of services) {
      const args = ['run', 'deploy', service.name, '--image', service.image, '--no-traffic', '--tag', 'candidate'];
      if (service.private) args.push('--update-env-vars', 'RESEARCH_DATABASE_MIGRATIONS=external');
      gcloud(...args);
      const candidate = describe(service.name).status.traffic.find(item => item.tag === 'candidate');
      if (!candidate?.url || !candidate.revisionName) throw new Error(`Missing candidate for ${service.name}`);
      service.revision = candidate.revisionName;
      service.candidateUrl = candidate.url;
      save();
      await smoke(service, candidate.url);
    }
    promotionStarted = true;
    for (const service of services) {
      gcloud('run', 'services', 'update-traffic', service.name, '--to-revisions', `${service.revision}=100`);
    }
    for (const service of services) await smoke(service, service.url);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    if (promotionStarted) {
      report.rollbackErrors = [];
      for (const service of services) {
        try {
          gcloud('run', 'services', 'update-traffic', service.name, '--to-revisions', service.previousTraffic);
        } catch (rollbackError) { report.rollbackErrors.push(rollbackError.message); }
      }
    }
    throw error;
  } finally { save(); }

  async function smoke(service, base) {
    const headers = {};
    if (service.private) {
      // The audience is the canonical service URL, including for tagged candidates.
      const token = execFileSync('gcloud', ['auth', 'print-identity-token',
        '--impersonate-service-account', process.env.GCP_DEPLOY_SERVICE_ACCOUNT,
        '--audiences', service.url, '--include-email'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
      headers.Authorization = `Bearer ${token}`;
    }
    const paths = service.private ? ['/healthz',
      '/api/internal/v1/ingestions/npm-downloads/checkpoint',
      '/api/internal/v1/ingestions/google-trends/checkpoint',
      '/api/internal/v1/ingestions/github-stars/checkpoint'] : ['/framework-popularity'];
    for (const path of paths) {
      const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`Smoke check ${service.name}${path}: ${response.status}`);
      if (service.private) await response.json();
      else if (!(await response.text()).includes('<html')) throw new Error('Web response is not HTML');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await deploy();
