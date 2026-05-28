import { env, parsePositiveNumber } from './env';

export interface GitHubConfig {
  cacheDbPath: string;
  graphqlEndpoint: string;
  issuesCacheTtlMs: number;
  labelsCacheTtlMs: number;
  token?: string;
  schemaPath?: string;
}

const TEN_DAYS_IN_MS = 10 * 24 * 60 * 60 * 1000;

export const getGitHubConfig = (): GitHubConfig => ({
  cacheDbPath: env.GITHUB_CACHE_DB_PATH ?? '.data/github-cache.sqlite',
  graphqlEndpoint: 'https://api.github.com/graphql',
  issuesCacheTtlMs: parsePositiveNumber(
    env.GITHUB_ISSUES_CACHE_TTL_MS,
    TEN_DAYS_IN_MS,
  ),
  labelsCacheTtlMs: parsePositiveNumber(
    env.GITHUB_LABELS_CACHE_TTL_MS,
    TEN_DAYS_IN_MS,
  ),
  token: env.GITHUB_TOKEN,
  schemaPath: env.GITHUB_GRAPHQL_SCHEMA_PATH,
});

export const getRequiredGitHubToken = (): string => {
  const { token } = getGitHubConfig();

  if (!token) {
    throw new Error('Missing GITHUB_TOKEN environment variable.');
  }

  return token;
};
