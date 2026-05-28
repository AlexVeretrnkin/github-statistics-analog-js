import { env, parsePositiveNumber } from './env';

export interface GeminiConfig {
  apiKey?: string;
  labelAnalysisCacheTtlMs: number;
  model: string;
}

const THIRTY_DAYS_IN_MS = 30 * 24 * 60 * 60 * 1000;

export const getGeminiConfig = (): GeminiConfig => ({
  apiKey: env.GEMINI_API_KEY,
  labelAnalysisCacheTtlMs: parsePositiveNumber(
    env.GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS,
    THIRTY_DAYS_IN_MS,
  ),
  model: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
});

export const getRequiredGeminiApiKey = (): string => {
  const { apiKey } = getGeminiConfig();

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }

  return apiKey;
};
