import { createServer } from 'node:http';

import {
  closeResearchDatabase,
  ensureResearchDatabaseSchema,
} from '@github-statistics/research-database/ingestion';

import { createIngestionRequestListener } from './server.js';

const port = parsePort(process.env['PORT']);

if (!process.env['DATABASE_URL']?.trim()) {
  throw new Error('DATABASE_URL is required by the ingestion service.');
}

await ensureResearchDatabaseSchema();

const server = createServer(createIngestionRequestListener());
server.listen(port, '0.0.0.0', () => {
  console.log(`Ingestion API listening on port ${port}.`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void closeResearchDatabase().finally(() => process.exit(0));
    });
  });
}

function parsePort(value: string | undefined): number {
  const portNumber = Number(value ?? '8080');

  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw new Error(`Invalid PORT: ${value ?? ''}`);
  }

  return portNumber;
}
