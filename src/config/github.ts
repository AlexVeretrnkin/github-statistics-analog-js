export interface GitHubConfig {
  cacheDbPath: string;
  graphqlEndpoint: string;
  issuesCacheTtlMs: number;
  labelsCacheTtlMs: number;
  token?: string;
  schemaPath?: string;
}

const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000;

const trimEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
  const normalized = trimEnv(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getGitHubConfig = (): GitHubConfig => ({
  cacheDbPath: trimEnv(process.env['GITHUB_CACHE_DB_PATH']) ?? '.data/github-cache.sqlite',
  graphqlEndpoint: 'https://api.github.com/graphql',
  issuesCacheTtlMs: parsePositiveNumber(
    process.env['GITHUB_ISSUES_CACHE_TTL_MS'],
    TEN_DAYS_IN_MS,
  ),
  labelsCacheTtlMs: parsePositiveNumber(
    process.env['GITHUB_LABELS_CACHE_TTL_MS'],
    TEN_DAYS_IN_MS,
  ),
  token: trimEnv(process.env['GITHUB_TOKEN']),
  schemaPath: trimEnv(process.env['GITHUB_GRAPHQL_SCHEMA_PATH']),
});

export const getRequiredGitHubToken = (): string => {
  const { token } = getGitHubConfig();

  if (!token) {
    throw new Error('Missing GITHUB_TOKEN environment variable.');
  }

  return token;
};
