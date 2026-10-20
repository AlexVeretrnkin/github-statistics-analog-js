import { afterEach, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./client.js', () => ({ getResearchDatabase: vi.fn(() => ({})) }));

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { applyMigrations, ensureResearchDatabaseSchema } from './migrations.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('external mode prevents startup and request paths from applying migrations', async () => {
  vi.stubEnv('RESEARCH_DATABASE_MIGRATIONS', 'external');
  await ensureResearchDatabaseSchema();
  expect(migrate).not.toHaveBeenCalled();
});

it('the explicit migration runner still applies migrations in external mode', async () => {
  vi.stubEnv('RESEARCH_DATABASE_MIGRATIONS', 'external');
  await applyMigrations();
  expect(migrate).toHaveBeenCalledOnce();
});
