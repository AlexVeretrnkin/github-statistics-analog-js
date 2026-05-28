export interface AppEnv {
  GEMINI_API_KEY?: string;
  GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS?: string;
  GEMINI_MODEL?: string;
  GITHUB_CACHE_DB_PATH?: string;
  GITHUB_GRAPHQL_SCHEMA_PATH?: string;
  GITHUB_ISSUES_CACHE_TTL_MS?: string;
  GITHUB_LABELS_CACHE_TTL_MS?: string;
  GITHUB_TOKEN?: string;
}

const trimEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const readEnv = (): AppEnv => ({
  GEMINI_API_KEY: trimEnv(process.env['GEMINI_API_KEY']),
  GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS: trimEnv(process.env['GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS']),
  GEMINI_MODEL: trimEnv(process.env['GEMINI_MODEL']),
  GITHUB_CACHE_DB_PATH: trimEnv(process.env['GITHUB_CACHE_DB_PATH']),
  GITHUB_GRAPHQL_SCHEMA_PATH: trimEnv(process.env['GITHUB_GRAPHQL_SCHEMA_PATH']),
  GITHUB_ISSUES_CACHE_TTL_MS: trimEnv(process.env['GITHUB_ISSUES_CACHE_TTL_MS']),
  GITHUB_LABELS_CACHE_TTL_MS: trimEnv(process.env['GITHUB_LABELS_CACHE_TTL_MS']),
  GITHUB_TOKEN: trimEnv(process.env['GITHUB_TOKEN']),
});

export const env = Object.freeze(readEnv());

export const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
