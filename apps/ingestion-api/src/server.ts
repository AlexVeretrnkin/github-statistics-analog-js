import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import {
  IngestionValidationError,
  validateBatchNumber,
  validateCreateGitHubStarsIngestionRun,
  validateCreateGoogleTrendsIngestionRun,
  validateCreateNpmIngestionRun,
  validateFailNpmIngestionRun,
  validateGoogleTrendsIngestionBatch,
  validateGitHubStarsIngestionBatch,
  validateNpmIngestionBatch,
  validateRunId,
} from '@github-statistics/ingestion-contracts';
import {
  commitGitHubStarsIngestionRun,
  commitGoogleTrendsIngestionRun,
  commitNpmIngestionRun,
  createGitHubStarsIngestionRun,
  createGoogleTrendsIngestionRun,
  createNpmIngestionRun,
  failGitHubStarsIngestionRun,
  failGoogleTrendsIngestionRun,
  failNpmIngestionRun,
  getGitHubStarsIngestionCheckpoint,
  getGoogleTrendsIngestionCheckpoint,
  getNpmIngestionCheckpoint,
  IngestionStateError,
  writeGitHubStarsIngestionBatch,
  writeGoogleTrendsIngestionBatch,
  writeNpmIngestionBatch,
} from '@github-statistics/research-database/ingestion';

const NPM_API_ROOT = '/api/internal/v1/ingestions/npm-downloads';
const GOOGLE_TRENDS_API_ROOT = '/api/internal/v1/ingestions/google-trends';
const GITHUB_STARS_API_ROOT = '/api/internal/v1/ingestions/github-stars';
const MAX_BODY_BYTES = 1024 * 1024;
const npmBatchPath = new RegExp(`^${NPM_API_ROOT}/runs/([^/]+)/batches/([^/]+)$`);
const npmCommitPath = new RegExp(`^${NPM_API_ROOT}/runs/([^/]+)/commit$`);
const npmFailPath = new RegExp(`^${NPM_API_ROOT}/runs/([^/]+)/fail$`);
const trendsBatchPath = new RegExp(`^${GOOGLE_TRENDS_API_ROOT}/runs/([^/]+)/batches/([^/]+)$`);
const trendsCommitPath = new RegExp(`^${GOOGLE_TRENDS_API_ROOT}/runs/([^/]+)/commit$`);
const trendsFailPath = new RegExp(`^${GOOGLE_TRENDS_API_ROOT}/runs/([^/]+)/fail$`);
const githubStarsBatchPath = new RegExp(`^${GITHUB_STARS_API_ROOT}/runs/([^/]+)/batches/([^/]+)$`);
const githubStarsCommitPath = new RegExp(`^${GITHUB_STARS_API_ROOT}/runs/([^/]+)/commit$`);
const githubStarsFailPath = new RegExp(`^${GITHUB_STARS_API_ROOT}/runs/([^/]+)/fail$`);

class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export function createIngestionRequestListener(): RequestListener {
  return (request, response) => {
    void serveIngestionRequest(request, response);
  };
}

export async function serveIngestionRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    await handleRequest(request, response);
  } catch (error) {
    handleError(error, response);
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://ingestion.local');

  // Google Frontend intercepts /healthz; retain it only as a local compatibility alias.
  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
    sendJson(response, 200, { service: 'github-statistics-ingestion', status: 'ok' });
    return;
  }

  if (request.method === 'GET' && url.pathname === `${NPM_API_ROOT}/checkpoint`) {
    sendJson(response, 200, await getNpmIngestionCheckpoint());
    return;
  }

  if (request.method === 'POST' && url.pathname === `${NPM_API_ROOT}/runs`) {
    const input = validateCreateNpmIngestionRun(await readJsonBody(request));
    sendJson(response, 201, await createNpmIngestionRun(input));
    return;
  }

  const batchMatch = request.method === 'PUT' ? npmBatchPath.exec(url.pathname) : null;
  if (batchMatch) {
    const runId = validateRunId(decodeURIComponent(batchMatch[1] ?? ''));
    const batchNumber = validateBatchNumber(decodeURIComponent(batchMatch[2] ?? ''));
    const input = validateNpmIngestionBatch(await readJsonBody(request));
    sendJson(response, 200, await writeNpmIngestionBatch(runId, batchNumber, input));
    return;
  }

  const commitMatch = request.method === 'POST' ? npmCommitPath.exec(url.pathname) : null;
  if (commitMatch) {
    const runId = validateRunId(decodeURIComponent(commitMatch[1] ?? ''));
    sendJson(response, 200, await commitNpmIngestionRun(runId));
    return;
  }

  const failMatch = request.method === 'POST' ? npmFailPath.exec(url.pathname) : null;
  if (failMatch) {
    const runId = validateRunId(decodeURIComponent(failMatch[1] ?? ''));
    const input = validateFailNpmIngestionRun(await readJsonBody(request));
    await failNpmIngestionRun(runId, input.error);
    sendJson(response, 200, { runId, status: 'failed' });
    return;
  }

  if (request.method === 'GET' && url.pathname === `${GOOGLE_TRENDS_API_ROOT}/checkpoint`) {
    sendJson(response, 200, await getGoogleTrendsIngestionCheckpoint());
    return;
  }

  if (request.method === 'POST' && url.pathname === `${GOOGLE_TRENDS_API_ROOT}/runs`) {
    const input = validateCreateGoogleTrendsIngestionRun(await readJsonBody(request));
    sendJson(response, 201, await createGoogleTrendsIngestionRun(input));
    return;
  }

  const trendsBatchMatch = request.method === 'PUT' ? trendsBatchPath.exec(url.pathname) : null;
  if (trendsBatchMatch) {
    const runId = validateRunId(decodeURIComponent(trendsBatchMatch[1] ?? ''));
    const batchNumber = validateBatchNumber(decodeURIComponent(trendsBatchMatch[2] ?? ''));
    const input = validateGoogleTrendsIngestionBatch(await readJsonBody(request));
    sendJson(response, 200, await writeGoogleTrendsIngestionBatch(runId, batchNumber, input));
    return;
  }

  const trendsCommitMatch = request.method === 'POST'
    ? trendsCommitPath.exec(url.pathname)
    : null;
  if (trendsCommitMatch) {
    const runId = validateRunId(decodeURIComponent(trendsCommitMatch[1] ?? ''));
    sendJson(response, 200, await commitGoogleTrendsIngestionRun(runId));
    return;
  }

  const trendsFailMatch = request.method === 'POST' ? trendsFailPath.exec(url.pathname) : null;
  if (trendsFailMatch) {
    const runId = validateRunId(decodeURIComponent(trendsFailMatch[1] ?? ''));
    const input = validateFailNpmIngestionRun(await readJsonBody(request));
    await failGoogleTrendsIngestionRun(runId, input.error);
    sendJson(response, 200, { runId, status: 'failed' });
    return;
  }

  if (request.method === 'GET' && url.pathname === `${GITHUB_STARS_API_ROOT}/checkpoint`) {
    sendJson(response, 200, await getGitHubStarsIngestionCheckpoint());
    return;
  }

  if (request.method === 'POST' && url.pathname === `${GITHUB_STARS_API_ROOT}/runs`) {
    const input = validateCreateGitHubStarsIngestionRun(await readJsonBody(request));
    sendJson(response, 201, await createGitHubStarsIngestionRun(input));
    return;
  }

  const githubStarsBatchMatch = request.method === 'PUT'
    ? githubStarsBatchPath.exec(url.pathname)
    : null;
  if (githubStarsBatchMatch) {
    const runId = validateRunId(decodeURIComponent(githubStarsBatchMatch[1] ?? ''));
    const batchNumber = validateBatchNumber(decodeURIComponent(githubStarsBatchMatch[2] ?? ''));
    const input = validateGitHubStarsIngestionBatch(await readJsonBody(request));
    sendJson(response, 200, await writeGitHubStarsIngestionBatch(runId, batchNumber, input));
    return;
  }

  const githubStarsCommitMatch = request.method === 'POST'
    ? githubStarsCommitPath.exec(url.pathname)
    : null;
  if (githubStarsCommitMatch) {
    const runId = validateRunId(decodeURIComponent(githubStarsCommitMatch[1] ?? ''));
    sendJson(response, 200, await commitGitHubStarsIngestionRun(runId));
    return;
  }

  const githubStarsFailMatch = request.method === 'POST'
    ? githubStarsFailPath.exec(url.pathname)
    : null;
  if (githubStarsFailMatch) {
    const runId = validateRunId(decodeURIComponent(githubStarsFailMatch[1] ?? ''));
    const input = validateFailNpmIngestionRun(await readJsonBody(request));
    await failGitHubStarsIngestionRun(runId, input.error);
    sendJson(response, 200, { runId, status: 'failed' });
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;

    if (bytes > MAX_BODY_BYTES) {
      throw new HttpError('Request body is too large.', 413);
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError('A JSON request body is required.', 400);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError('Request body must contain valid JSON.', 400);
  }
}

function handleError(error: unknown, response: ServerResponse): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  if (error instanceof IngestionValidationError) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  if (error instanceof IngestionStateError || error instanceof HttpError) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }

  console.error('Unhandled ingestion request error.', error);
  sendJson(response, 500, { error: 'Internal server error.' });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}
