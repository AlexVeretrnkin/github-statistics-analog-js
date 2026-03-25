import { createError } from 'h3';
import { z } from 'zod';

export interface RepositoryAnalysisDetailInput {
  owner: string;
  repo: string;
}

const repositoryAnalysisDetailSchema = z.object({
  owner: z
    .string({ required_error: 'Route parameter "owner" is required.' })
    .trim()
    .min(1, 'Route parameter "owner" is required.'),
  repo: z
    .string({ required_error: 'Route parameter "repo" is required.' })
    .trim()
    .min(1, 'Route parameter "repo" is required.'),
});

export const validateRepositoryAnalysisDetailParams = (
  params: unknown,
): RepositoryAnalysisDetailInput => {
  const result = repositoryAnalysisDetailSchema.safeParse(params);

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? 'Invalid route parameters.',
    });
  }

  return result.data;
};
