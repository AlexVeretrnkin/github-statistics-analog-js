import { createError } from 'h3';
import { z } from 'zod';

export interface FetchRepositoryIssuesInput {
  owner: string;
  repo: string;
  from: string;
  to: string;
  labels?: string[];
}

const monthSchema = z
  .string({ required_error: 'Month is required.' })
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format.');

const issuesQuerySchema = z
  .object({
    owner: z
      .string({ required_error: 'Query parameter "owner" is required.' })
      .trim()
      .min(1, 'Query parameter "owner" is required.'),
    repo: z
      .string({ required_error: 'Query parameter "repo" is required.' })
      .trim()
      .min(1, 'Query parameter "repo" is required.'),
    from: monthSchema,
    to: monthSchema,
    labels: z
      .string()
      .optional()
      .transform((value) => {
        const labels = value
          ?.split(',')
          .map((label) => label.trim())
          .filter(Boolean);

        return labels?.length ? labels : undefined;
      }),
  })
  .superRefine(({ from, to }, ctx) => {
    if (from > to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Query parameter "to" must be greater than or equal to "from".',
      });
    }

    const monthCount = getMonthSpan(from, to);

    if (monthCount > 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'The requested period is too large. Please use a range of 24 months or less.',
      });
    }
  });

export const validateIssuesQuery = (
  query: unknown,
): FetchRepositoryIssuesInput => {
  const result = issuesQuerySchema.safeParse(query);

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: result.error.issues[0]?.message ?? 'Invalid query parameters.',
    });
  }

  return result.data;
};

const getMonthSpan = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);

  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
};
