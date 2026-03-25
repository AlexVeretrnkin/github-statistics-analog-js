import { createError } from 'h3';
import { z } from 'zod';

export interface AnalyzeRepositoryLabelsInput {
  owner: string;
  refresh?: boolean;
  repo: string;
}

const labelAnalysisQuerySchema = z.object({
  owner: z
    .string({ required_error: 'Query parameter "owner" is required.' })
    .trim()
    .min(1, 'Query parameter "owner" is required.'),
  refresh: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
  repo: z
    .string({ required_error: 'Query parameter "repo" is required.' })
    .trim()
    .min(1, 'Query parameter "repo" is required.'),
});

export const validateLabelAnalysisQuery = (
  query: unknown,
): AnalyzeRepositoryLabelsInput => {
  const result = labelAnalysisQuerySchema.safeParse(query);

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? 'Invalid query parameters.',
    });
  }

  return result.data;
};
