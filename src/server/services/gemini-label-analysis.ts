import { createError } from 'h3';
import { GoogleGenAI } from '@google/genai';

import { getGeminiConfig, getRequiredGeminiApiKey } from '../../config/gemini';
import {
  buildLabelAnalysisCacheKey,
  listAnalyzedRepositories,
  readAnalyzedRepositoryDetail,
  readLabelAnalysisCache,
  saveAnalyzedRepositoryIndex,
  writeLabelAnalysisCache,
} from '../lib/cache/github-cache';
import { fetchRepositoryLabels } from './github-graphql';
import type { AnalyzeRepositoryLabelsInput } from '../validation/label-analysis-query';

const LABEL_ANALYSIS_PROMPT_VERSION = 'v1';

export const PREDEFINED_LABEL_CATEGORIES = [
  'technical_debt',
  'bug_fixing',
  'feature_work',
  'documentation',
  'maintenance',
  'testing_quality',
  'performance',
  'security',
  'developer_experience',
  'infra_devops',
  'community_support',
  'other',
] as const;

export type PredefinedLabelCategory = (typeof PREDEFINED_LABEL_CATEGORIES)[number];

export interface EmergentCategorySuggestion {
  name: string;
  reason: string;
}

export interface LabelAnalysisItem {
  confidence: number;
  label_name: string;
  primary_category: PredefinedLabelCategory;
  reason: string;
  secondary_categories: PredefinedLabelCategory[];
  suggested_category: string;
}

export interface RepositoryLabelAnalysisResponse {
  emergent_categories: EmergentCategorySuggestion[];
  labels: LabelAnalysisItem[];
  model: string;
  prompt_version: string;
  provider: 'gemini';
  repository: {
    id: string;
    name: string;
    owner: string;
  };
}

interface LabelAnalysisStructuredOutput {
  emergent_categories: EmergentCategorySuggestion[];
  labels: LabelAnalysisItem[];
}

export async function analyzeRepositoryLabels({
  owner,
  refresh,
  repo,
}: AnalyzeRepositoryLabelsInput): Promise<RepositoryLabelAnalysisResponse> {
  const labelsResponse = await fetchRepositoryLabels({ owner, repo });
  const model = getGeminiConfig().model;
  const cacheKey = buildLabelAnalysisCacheKey({
    model,
    owner,
    promptVersion: LABEL_ANALYSIS_PROMPT_VERSION,
    repo,
    labels: labelsResponse.labels,
  });

  if (!refresh) {
    const cachedResponse = readLabelAnalysisCache<RepositoryLabelAnalysisResponse>(cacheKey);

    if (cachedResponse) {
      saveAnalyzedRepositoryIndex({
        analyzedAt: new Date().toISOString(),
        cacheKey,
        model,
        owner,
        promptVersion: LABEL_ANALYSIS_PROMPT_VERSION,
        provider: 'gemini',
        repo,
        repositoryId: cachedResponse.repository.id,
      });

      return cachedResponse;
    }
  }

  if (labelsResponse.labels.length === 0) {
    return {
      emergent_categories: [],
      labels: [],
      model,
      prompt_version: LABEL_ANALYSIS_PROMPT_VERSION,
      provider: 'gemini',
      repository: labelsResponse.repository,
    };
  }

  let apiKey: string;

  try {
    apiKey = getRequiredGeminiApiKey();
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing GEMINI_API_KEY environment variable.',
    });
  }

  const client = new GoogleGenAI({
    apiKey,
  });

  let textContent: string | undefined;

  try {
    const response = await client.models.generateContent({
      model,
      contents: buildPrompt({
        owner,
        repo,
        labels: labelsResponse.labels,
      }),
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: getLabelAnalysisSchema(),
      },
    });

    textContent = response.text;
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: error instanceof Error ? error.message : 'Gemini request failed.',
    });
  }

  if (!textContent) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Gemini response did not include structured output text.',
    });
  }

  const parsed = JSON.parse(textContent) as LabelAnalysisStructuredOutput;
  const normalized = normalizeLabelAnalysis(parsed, labelsResponse.labels.map((label) => label.name));

  const response: RepositoryLabelAnalysisResponse = {
    emergent_categories: normalized.emergent_categories,
    labels: normalized.labels,
    model,
    prompt_version: LABEL_ANALYSIS_PROMPT_VERSION,
    provider: 'gemini',
    repository: labelsResponse.repository,
  };

  writeLabelAnalysisCache(cacheKey, response);
  saveAnalyzedRepositoryIndex({
    analyzedAt: new Date().toISOString(),
    cacheKey,
    model,
    owner,
    promptVersion: LABEL_ANALYSIS_PROMPT_VERSION,
    provider: 'gemini',
    repo,
    repositoryId: response.repository.id,
  });

  return response;
}

export function getAnalyzedRepositories() {
  return listAnalyzedRepositories();
}

export function getAnalyzedRepositoryDetails({
  owner,
  repo,
}: {
  owner: string;
  repo: string;
}) {
  return readAnalyzedRepositoryDetail<RepositoryLabelAnalysisResponse>({
    owner,
    repo,
  });
}

function buildPrompt({
  labels,
  owner,
  repo,
}: {
  labels: Array<{ description: string | null; name: string }>;
  owner: string;
  repo: string;
}): string {
  return JSON.stringify({
    task: 'Classify GitHub repository labels for a software engineering research tool.',
    instructions: [
      'Map every label into the predefined categories.',
      `The predefined categories are: ${PREDEFINED_LABEL_CATEGORIES.join(', ')}.`,
      'Always classify every label.',
      'Use technical_debt for labels that indicate refactoring, cleanup, architecture maintenance, legacy replacement, modernization, chore-like technical upkeep, or similar non-feature engineering debt work.',
      'Use suggested_category only when an additional useful category emerges beyond the predefined set. Otherwise return an empty string.',
      'Keep secondary_categories short, relevant, and unique.',
      'Confidence must be a number from 0 to 1.',
      'Reasons should be concise and research-oriented.',
      'Return only JSON that matches the response schema.',
    ],
    repository: `${owner}/${repo}`,
    labels: labels.map((label) => ({
      description: label.description ?? '',
      name: label.name,
    })),
  });
}

function getLabelAnalysisSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['emergent_categories', 'labels'],
    properties: {
      emergent_categories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'reason'],
          properties: {
            name: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
      labels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'confidence',
            'label_name',
            'primary_category',
            'reason',
            'secondary_categories',
            'suggested_category',
          ],
          properties: {
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
            },
            label_name: { type: 'string' },
            primary_category: {
              type: 'string',
              enum: [...PREDEFINED_LABEL_CATEGORIES],
            },
            reason: { type: 'string' },
            secondary_categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: [...PREDEFINED_LABEL_CATEGORIES],
              },
            },
            suggested_category: { type: 'string' },
          },
        },
      },
    },
  };
}

function normalizeLabelAnalysis(
  analysis: LabelAnalysisStructuredOutput,
  requestedLabelNames: string[],
): LabelAnalysisStructuredOutput {
  const knownNames = new Map(
    requestedLabelNames.map((labelName) => [labelName.toLowerCase(), labelName] as const),
  );
  const labels = analysis.labels
    .map((item) => ({
      ...item,
      label_name: knownNames.get(item.label_name.toLowerCase()) ?? item.label_name,
    }))
    .filter((item) => knownNames.has(item.label_name.toLowerCase()))
    .map((item) => ({
      ...item,
      confidence: Math.min(1, Math.max(0, item.confidence)),
      secondary_categories: [...new Set(item.secondary_categories)].filter(
        (category) => category !== item.primary_category,
      ),
      suggested_category: item.suggested_category.trim(),
    }));

  for (const labelName of requestedLabelNames) {
    if (!labels.some((item) => item.label_name === labelName)) {
      labels.push({
        confidence: 0,
        label_name: labelName,
        primary_category: 'other',
        reason: 'No category was returned for this label.',
        secondary_categories: [],
        suggested_category: '',
      });
    }
  }

  return {
    emergent_categories: analysis.emergent_categories.filter(
      (category) => category.name.trim() && category.reason.trim(),
    ),
    labels: labels.sort((left, right) => left.label_name.localeCompare(right.label_name)),
  };
}
