import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getGitHubConfig } from '../../../config/github';

let databaseInstance: DatabaseSync | undefined;

export function getCacheDatabase(): DatabaseSync {
  if (databaseInstance) {
    return databaseInstance;
  }

  const databasePath = resolve(process.cwd(), getGitHubConfig().cacheDbPath);

  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS github_api_cache (
      cache_key TEXT NOT NULL,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (scope, cache_key)
    );

    CREATE INDEX IF NOT EXISTS github_api_cache_scope_idx
    ON github_api_cache (scope);

    CREATE INDEX IF NOT EXISTS github_api_cache_expires_at_idx
    ON github_api_cache (expires_at);

    CREATE TABLE IF NOT EXISTS analyzed_repositories (
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      analysis_cache_key TEXT NOT NULL,
      analyzed_at TEXT NOT NULL,
      PRIMARY KEY (owner, repo)
    );

    CREATE INDEX IF NOT EXISTS analyzed_repositories_analyzed_at_idx
    ON analyzed_repositories (analyzed_at DESC);

    CREATE TABLE IF NOT EXISTS repository_archive (
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      repository_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      analysis_cache_key TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (owner, repo)
    );

    CREATE INDEX IF NOT EXISTS repository_archive_last_seen_at_idx
    ON repository_archive (last_seen_at DESC);
  `);

  databaseInstance = database;

  return database;
}
