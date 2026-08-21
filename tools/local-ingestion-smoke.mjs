const ingestionUrl = stripTrailingSlash(
  process.env.LOCAL_INGESTION_URL ?? 'http://127.0.0.1:8081',
);
const webUrl = stripTrailingSlash(process.env.LOCAL_WEB_URL ?? 'http://127.0.0.1:8080');
const apiRoot = `${ingestionUrl}/api/internal/v1/ingestions/npm-downloads`;

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
  const webResponse = await fetch(`${webUrl}/framework-popularity`);

  if (!webResponse.ok) {
    throw new Error(`Web verification failed with HTTP ${webResponse.status}.`);
  }

  console.log(JSON.stringify({
    committed,
    ingestionUrl,
    latestDate: updatedCheckpoint.latestDate,
    rowsPrepared: rows.length,
    webStatus: webResponse.status,
    webUrl: `${webUrl}/framework-popularity`,
  }, null, 2));
} catch (error) {
  await requestJson(`${apiRoot}/runs/${run.runId}/fail`, {
    body: { error: error instanceof Error ? error.message : String(error) },
    method: 'POST',
  }).catch(() => undefined);
  throw error;
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
