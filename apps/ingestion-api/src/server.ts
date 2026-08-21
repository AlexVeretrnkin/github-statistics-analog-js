import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import {
  IngestionValidationError,
  validateBatchNumber,
  validateCreateNpmIngestionRun,
  validateFailNpmIngestionRun,
  validateNpmIngestionBatch,
  validateRunId,
} from '@github-statistics/ingestion-contracts';
import {
  commitNpmIngestionRun,
  createNpmIngestionRun,
  failNpmIngestionRun,
  getNpmIngestionCheckpoint,
  IngestionStateError,
  writeNpmIngestionBatch,
} from '@github-statistics/research-database/ingestion';

const API_ROOT = '/api/internal/v1/ingestions/npm-downloads';
const MAX_BODY_BYTES = 1024 * 1024;
const batchPath = new RegExp(`^${API_ROOT}/runs/([^/]+)/batches/([^/]+)$`);
const commitPath = new RegExp(`^${API_ROOT}/runs/([^/]+)/commit$`);
const failPath = new RegExp(`^${API_ROOT}/runs/([^/]+)/fail$`);

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

  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { service: 'github-statistics-ingestion', status: 'ok' });
    return;
  }

  if (request.method === 'GET' && url.pathname === `${API_ROOT}/checkpoint`) {
    sendJson(response, 200, await getNpmIngestionCheckpoint());
    return;
  }

  if (request.method === 'POST' && url.pathname === `${API_ROOT}/runs`) {
    const input = validateCreateNpmIngestionRun(await readJsonBody(request));
    sendJson(response, 201, await createNpmIngestionRun(input));
    return;
  }

  const batchMatch = request.method === 'PUT' ? batchPath.exec(url.pathname) : null;
  if (batchMatch) {
    const runId = validateRunId(decodeURIComponent(batchMatch[1] ?? ''));
    const batchNumber = validateBatchNumber(decodeURIComponent(batchMatch[2] ?? ''));
    const input = validateNpmIngestionBatch(await readJsonBody(request));
    sendJson(response, 200, await writeNpmIngestionBatch(runId, batchNumber, input));
    return;
  }

  const commitMatch = request.method === 'POST' ? commitPath.exec(url.pathname) : null;
  if (commitMatch) {
    const runId = validateRunId(decodeURIComponent(commitMatch[1] ?? ''));
    sendJson(response, 200, await commitNpmIngestionRun(runId));
    return;
  }

  const failMatch = request.method === 'POST' ? failPath.exec(url.pathname) : null;
  if (failMatch) {
    const runId = validateRunId(decodeURIComponent(failMatch[1] ?? ''));
    const input = validateFailNpmIngestionRun(await readJsonBody(request));
    await failNpmIngestionRun(runId, input.error);
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
