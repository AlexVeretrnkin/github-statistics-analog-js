import { createError } from 'h3';
import { z } from 'zod';

export interface FetchRepositoryLabelsInput {
  owner: string;
  repo: string;
}

const labelsQuerySchema = z.object({
  owner: z
    .string({ required_error: 'Query parameter "owner" is required.' })
    .trim()
    .min(1, 'Query parameter "owner" is required.'),
  repo: z
    .string({ required_error: 'Query parameter "repo" is required.' })
    .trim()
    .min(1, 'Query parameter "repo" is required.'),
});

export const validateLabelsQuery = (
  query: unknown,
): FetchRepositoryLabelsInput => {
  const result = labelsQuerySchema.safeParse(query);

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? 'Invalid query parameters.',
    });
  }

  return result.data;
};
