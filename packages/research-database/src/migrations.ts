import { fileURLToPath } from 'node:url';

import { migrate as runMigrations } from 'drizzle-orm/postgres-js/migrator';

import { getResearchDatabase } from './client.js';

let migrationPromise: Promise<void> | undefined;

export function ensureResearchDatabaseSchema(): Promise<void> {
  if (process.env['RESEARCH_DATABASE_MIGRATIONS'] === 'external') {
    return Promise.resolve();
  }
  migrationPromise ??= applyMigrations().catch((error: unknown) => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}

export async function applyMigrations(): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await runMigrations(getResearchDatabase(), { migrationsFolder });
}
