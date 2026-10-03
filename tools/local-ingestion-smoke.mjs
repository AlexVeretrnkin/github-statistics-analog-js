const ingestionUrl = stripTrailingSlash(
  process.env.LOCAL_INGESTION_URL ?? 'http://127.0.0.1:8081',
);
const webUrl = stripTrailingSlash(process.env.LOCAL_WEB_URL ?? 'http://127.0.0.1:8080');
const apiRoot = `${ingestionUrl}/api/internal/v1/ingestions/npm-downloads`;
const trendsApiRoot = `${ingestionUrl}/api/internal/v1/ingestions/google-trends`;
const githubStarsApiRoot = `${ingestionUrl}/api/internal/v1/ingestions/github-stars`;

const checkpoint = await requestJson(`${apiRoot}/checkpoint`);
const sourceDataThrough = checkpoint.latestDate ?? '2015-01-31';
const startDate = checkpoint.latestDate
  ? shiftIsoDate(checkpoint.latestDate, -14)
  : '2015-01-01';
const rows = ['react', '@angular/core', 'vue'].flatMap((packageName, packageIndex) =>
  dateRange(startDate, sourceDataThrough).map((date, dateIndex) => ({
    date,
    downloads: (packageIndex + 1) * 1000 + dateIndex,
    package: packageName,
  })),
);

const run = await requestJson(`${apiRoot}/runs`, {
  body: {
    gitSha: 'local-smoke',
    metadata: { kind: 'deterministic-local-smoke' },
    schemaVersion: 1,
    sourceDataThrough,
  },
  method: 'POST',
});
let trendsRun;
let githubStarsRun;

try {
  for (let offset = 0, batchNumber = 0; offset < rows.length; offset += 500, batchNumber += 1) {
    await requestJson(`${apiRoot}/runs/${run.runId}/batches/${batchNumber}`, {
      body: { rows: rows.slice(offset, offset + 500) },
      method: 'PUT',
    });
  }

  const committed = await requestJson(`${apiRoot}/runs/${run.runId}/commit`, {
    method: 'POST',
  });
  const updatedCheckpoint = await requestJson(`${apiRoot}/checkpoint`);

  const trendsDates = weeklyDateRange('2021-01-03', 260);
  const trendsRows = ['React', 'Angular', 'Vue'].flatMap((framework, frameworkIndex) =>
    trendsDates.map((date, dateIndex) => ({
      date,
      framework,
      interest: (frameworkIndex * 10 + dateIndex) % 101,
    })),
  );
  trendsRun = await requestJson(`${trendsApiRoot}/runs`, {
    body: {
      completedMonthBefore: '2025-12-01',
      gitSha: 'local-smoke',
      metadata: { category: 31, kind: 'deterministic-local-smoke' },
      schemaVersion: 1,
      sourceDataThrough: trendsDates.at(-1),
    },
    method: 'POST',
  });
  for (let offset = 0, batchNumber = 0;
    offset < trendsRows.length;
    offset += 500, batchNumber += 1) {
    await requestJson(`${trendsApiRoot}/runs/${trendsRun.runId}/batches/${batchNumber}`, {
      body: { rows: trendsRows.slice(offset, offset + 500) },
      method: 'PUT',
    });
  }
  const trendsCommitted = await requestJson(
    `${trendsApiRoot}/runs/${trendsRun.runId}/commit`,
    { method: 'POST' },
  );
  const trendsCheckpoint = await requestJson(`${trendsApiRoot}/checkpoint`);
  const githubStarsCheckpointBefore = await requestJson(`${githubStarsApiRoot}/checkpoint`);
  const githubStarsThrough = githubStarsCheckpointBefore.latestDate ?? '2026-02-01';
  const githubStarsStart = shiftIsoDate(githubStarsThrough, -75);
  const githubStarsRows = [
    ['facebook/react', 'React'],
    ['angular/angular', 'Angular'],
    ['vuejs/core', 'Vue'],
  ].flatMap(([repository, framework], repositoryIndex) =>
    dateRange(githubStarsStart, githubStarsThrough).map((date) => ({
      date,
      framework,
      newStars: repositoryIndex + 1,
      repository,
    })),
  );
  githubStarsRun = await requestJson(`${githubStarsApiRoot}/runs`, {
    body: {
      completedMonthBefore: `${githubStarsThrough.slice(0, 7)}-01`,
      gitSha: 'local-smoke',
      metadata: { apiVersion: '2026-03-10', kind: 'deterministic-local-smoke' },
      schemaVersion: 1,
      sourceDataThrough: githubStarsThrough,
    },
    method: 'POST',
  });
  for (let offset = 0, batchNumber = 0;
    offset < githubStarsRows.length;
    offset += 500, batchNumber += 1) {
    await requestJson(`${githubStarsApiRoot}/runs/${githubStarsRun.runId}/batches/${batchNumber}`, {
      body: { rows: githubStarsRows.slice(offset, offset + 500) },
      method: 'PUT',
    });
  }
  const githubStarsCommitted = await requestJson(
    `${githubStarsApiRoot}/runs/${githubStarsRun.runId}/commit`,
    { method: 'POST' },
  );
  const githubStarsCheckpoint = await requestJson(`${githubStarsApiRoot}/checkpoint`);
  const webResponse = await fetch(`${webUrl}/framework-popularity`);

  if (!webResponse.ok) {
    throw new Error(`Web verification failed with HTTP ${webResponse.status}.`);
  }

  console.log(JSON.stringify({
    committed,
    githubStarsCommitted,
    githubStarsLatestDate: githubStarsCheckpoint.latestDate,
    githubStarsRowsPrepared: githubStarsRows.length,
    ingestionUrl,
    latestDate: updatedCheckpoint.latestDate,
    rowsPrepared: rows.length,
    trendsCommitted,
    trendsLatestDate: trendsCheckpoint.latestDate,
    trendsRowsPrepared: trendsRows.length,
    webStatus: webResponse.status,
    webUrl: `${webUrl}/framework-popularity`,
  }, null, 2));
} catch (error) {
  if (githubStarsRun) {
    await requestJson(`${githubStarsApiRoot}/runs/${githubStarsRun.runId}/fail`, {
      body: { error: error instanceof Error ? error.message : String(error) },
      method: 'POST',
    }).catch(() => undefined);
  }
  if (trendsRun) {
    await requestJson(`${trendsApiRoot}/runs/${trendsRun.runId}/fail`, {
      body: { error: error instanceof Error ? error.message : String(error) },
      method: 'POST',
    }).catch(() => undefined);
  }
  await requestJson(`${apiRoot}/runs/${run.runId}/fail`, {
    body: { error: error instanceof Error ? error.message : String(error) },
    method: 'POST',
  }).catch(() => undefined);
  throw error;
}

function weeklyDateRange(start, count) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    method: options.method ?? 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

function dateRange(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);

  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function shiftIsoDate(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
