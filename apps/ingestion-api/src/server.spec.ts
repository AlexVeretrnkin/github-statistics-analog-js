import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { serveIngestionRequest } from './server.js';

describe('ingestion API transport', () => {
  it('exposes only the dedicated health response at the root level', async () => {
    const health = await request('GET', '/healthz');
    expect(health).toEqual({
      body: { service: 'github-statistics-ingestion', status: 'ok' },
      status: 200,
    });

    const root = await request('GET', '/');
    expect(root).toEqual({ body: { error: 'Not found.' }, status: 404 });
  });

  it('rejects invalid ingestion payloads before opening the database', async () => {
    const response = await request(
      'POST',
      '/api/internal/v1/ingestions/npm-downloads/runs',
      JSON.stringify({ schemaVersion: 1, sourceDataThrough: 'not-a-date' }),
    );

    expect(response).toEqual({ body: { error: 'Expected an ISO date.' }, status: 400 });
  });
});

async function request(
  method: string,
  url: string,
  body?: string,
): Promise<{ body: unknown; status: number }> {
  const incoming = Readable.from(body ? [body] : []) as IncomingMessage;
  incoming.method = method;
  incoming.url = url;

  let responseBody = '';
  const response = {
    end(value?: string) {
      responseBody = value ?? '';
      this.headersSent = true;
    },
    headersSent: false,
    setHeader() {},
    statusCode: 200,
  } as unknown as ServerResponse;

  await serveIngestionRequest(incoming, response);

  return {
    body: JSON.parse(responseBody) as unknown,
    status: response.statusCode,
  };
}
