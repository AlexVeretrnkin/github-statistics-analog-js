import { getGitHubConfig } from '../../../config/github';
import { getGeminiConfig } from '../../../config/gemini';
import type { FetchRepositoryIssuesInput } from '../../validation/issues-query';
import type { FetchRepositoryLabelsInput } from '../../validation/labels-query';
import { getCacheDatabase } from './database';

type CacheScope = 'issues-timeseries' | 'repository-labels' | 'label-category-analysis';

interface CachedRow {
  payload: string;
}

interface AnalyzedRepositoryRow {
  last_seen_at: string;
  model: string;
  owner: string;
  prompt_version: string;
  provider: string;
  repo: string;
  repository_id: string;
  analysis_cache_key: string;
}

interface GitHubCacheEntry<T> {
  key: string;
  payload: T;
  scope: CacheScope;
  ttlMs: number;
}

export interface AnalyzedRepositoryListItem {
  analyzedAt: string;
  model: string;
  owner: string;
  promptVersion: string;
  provider: string;
  repo: string;
  repositoryId: string;
}

export function buildIssuesCacheKey({
  owner,
  repo,
  from,
  to,
  labels,
}: FetchRepositoryIssuesInput): string {
  return JSON.stringify({
    owner: owner.trim().toLowerCase(),
    repo: repo.trim().toLowerCase(),
    from,
    to,
    labels: normalizeLabels(labels ?? []),
  });
}

export function buildLabelsCacheKey({
  owner,
  repo,
}: FetchRepositoryLabelsInput): string {
  return JSON.stringify({
    owner: owner.trim().toLowerCase(),
    repo: repo.trim().toLowerCase(),
  });
}

export function buildLabelAnalysisCacheKey({
  labels,
  model,
  owner,
  promptVersion,
  repo,
}: {
  labels: Array<{ description: string | null; name: string }>;
  model: string;
  owner: string;
  promptVersion: string;
  repo: string;
}): string {
  return JSON.stringify({
    labels: [...labels]
      .map((label) => ({
        description: label.description?.trim() ?? '',
        name: label.name.trim(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    model,
    owner: owner.trim().toLowerCase(),
    promptVersion,
    repo: repo.trim().toLowerCase(),
  });
}

export function readIssuesCache<T>(key: string): T | null {
  return readCache<T>('issues-timeseries', key);
}

export function writeIssuesCache<T>(key: string, payload: T): void {
  writeCache({
    key,
    payload,
    scope: 'issues-timeseries',
    ttlMs: getGitHubConfig().issuesCacheTtlMs,
  });
}

export function readLabelsCache<T>(key: string): T | null {
  return readCache<T>('repository-labels', key);
}

export function writeLabelsCache<T>(key: string, payload: T): void {
  writeCache({
    key,
    payload,
    scope: 'repository-labels',
    ttlMs: getGitHubConfig().labelsCacheTtlMs,
  });
}

export function readLabelAnalysisCache<T>(key: string): T | null {
  return readCache<T>('label-category-analysis', key);
}

export function writeLabelAnalysisCache<T>(key: string, payload: T): void {
  writeCache({
    key,
    payload,
    scope: 'label-category-analysis',
    ttlMs: getGeminiConfig().labelAnalysisCacheTtlMs,
  });
}

export function saveAnalyzedRepositoryIndex({
  analyzedAt,
  cacheKey,
  model,
  owner,
  promptVersion,
  provider,
  repo,
  repositoryId,
}: {
  analyzedAt: string;
  cacheKey: string;
  model: string;
  owner: string;
  promptVersion: string;
  provider: string;
  repo: string;
  repositoryId: string;
}): void {
  const database = getCacheDatabase();

  database
    .prepare(
      `
        INSERT INTO repository_archive (
          owner,
          repo,
          repository_id,
          provider,
          model,
          prompt_version,
          analysis_cache_key,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner, repo)
        DO UPDATE SET
          repository_id = excluded.repository_id,
          provider = excluded.provider,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          analysis_cache_key = excluded.analysis_cache_key,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      owner.trim().toLowerCase(),
      repo.trim().toLowerCase(),
      repositoryId,
      provider,
      model,
      promptVersion,
      cacheKey,
      analyzedAt,
    );
}

export function saveRepositoryArchiveEntry({
  owner,
  repo,
  repositoryId,
}: {
  owner: string;
  repo: string;
  repositoryId: string;
}): void {
  const database = getCacheDatabase();
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `
        INSERT INTO repository_archive (
          owner,
          repo,
          repository_id,
          provider,
          model,
          prompt_version,
          analysis_cache_key,
          last_seen_at
        )
        VALUES (?, ?, ?, '', '', '', '', ?)
        ON CONFLICT(owner, repo)
        DO UPDATE SET
          repository_id = excluded.repository_id,
          last_seen_at = excluded.last_seen_at
      `,
    )
    .run(
      owner.trim().toLowerCase(),
      repo.trim().toLowerCase(),
      repositoryId,
      timestamp,
    );
}

export function listAnalyzedRepositories(): AnalyzedRepositoryListItem[] {
  const database = getCacheDatabase();
  const rows = database
    .prepare(
      `
        SELECT owner, repo, repository_id, provider, model, prompt_version, last_seen_at, analysis_cache_key
        FROM repository_archive
        ORDER BY last_seen_at DESC
      `
    )
    .all() as unknown as AnalyzedRepositoryRow[];

  return rows.map((row) => ({
    analyzedAt: row.last_seen_at,
    model: row.model || 'not analyzed yet',
    owner: row.owner,
    promptVersion: row.prompt_version,
    provider: row.provider || 'repository archive',
    repo: row.repo,
    repositoryId: row.repository_id,
  }));
}

export function readAnalyzedRepositoryDetail<T>({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}): T | null {
  const database = getCacheDatabase();
  const indexRow = database
    .prepare(
      `
        SELECT analysis_cache_key
        FROM repository_archive
        WHERE owner = ? AND repo = ?
      `,
    )
    .get(owner.trim().toLowerCase(), repo.trim().toLowerCase()) as
    | { analysis_cache_key: string }
    | undefined;

  if (!indexRow || !indexRow.analysis_cache_key) {
    return null;
  }

  return readLabelAnalysisCache<T>(indexRow.analysis_cache_key);
}

function readCache<T>(scope: CacheScope, key: string): T | null {
  purgeExpiredCacheEntries();

  const database = getCacheDatabase();
  const row = database
    .prepare(
      `
        SELECT payload
        FROM github_api_cache
        WHERE cache_key = ? AND scope = ? AND expires_at > ?
      `,
    )
    .get(key, scope, new Date().toISOString()) as CachedRow | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.payload) as T;
}

function writeCache<T>({ key, payload, scope, ttlMs }: GitHubCacheEntry<T>): void {
  purgeExpiredCacheEntries();

  const database = getCacheDatabase();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  database
    .prepare(
      `
        INSERT INTO github_api_cache (cache_key, scope, payload, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope, cache_key)
        DO UPDATE SET
          scope = excluded.scope,
          payload = excluded.payload,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
      `,
    )
    .run(key, scope, JSON.stringify(payload), createdAt.toISOString(), expiresAt.toISOString());
}

function purgeExpiredCacheEntries(): void {
  const database = getCacheDatabase();

  database
    .prepare('DELETE FROM github_api_cache WHERE expires_at <= ?')
    .run(new Date().toISOString());
}

function normalizeLabels(labels: string[]): string[] {
  return [...labels]
    .map((label) => label.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}
