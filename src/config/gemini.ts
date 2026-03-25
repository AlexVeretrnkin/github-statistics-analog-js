export interface GeminiConfig {
  apiKey?: string;
  labelAnalysisCacheTtlMs: number;
  model: string;
}

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

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

export const getGeminiConfig = (): GeminiConfig => ({
  apiKey: trimEnv(process.env['GEMINI_API_KEY']),
  labelAnalysisCacheTtlMs: parsePositiveNumber(
    process.env['GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS'],
    THIRTY_DAYS_IN_MS,
  ),
  model: trimEnv(process.env['GEMINI_MODEL']) ?? 'gemini-2.5-flash',
});

export const getRequiredGeminiApiKey = (): string => {
  const { apiKey } = getGeminiConfig();

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }

  return apiKey;
};
