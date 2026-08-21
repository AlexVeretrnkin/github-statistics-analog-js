import { fileURLToPath } from 'node:url';

import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';

import { getResearchDatabase } from './client.js';

let migrationPromise: Promise<void> | undefined;

export function ensureResearchDatabaseSchema(): Promise<void> {
  migrationPromise ??= applyMigrations().catch((error: unknown) => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}

async function applyMigrations(): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await runMigrations(getResearchDatabase(), { migrationsFolder });
}
