import { z } from 'zod';

export const NPM_INGESTION_SCHEMA_VERSION = 1;
export const NPM_PACKAGES = ['react', '@angular/core', 'vue'] as const;
export type NpmPackage = (typeof NPM_PACKAGES)[number];
export const GOOGLE_TRENDS_INGESTION_SCHEMA_VERSION = 1;
export const GOOGLE_TRENDS_FRAMEWORKS = ['React', 'Angular', 'Vue'] as const;
export type GoogleTrendsFramework = (typeof GOOGLE_TRENDS_FRAMEWORKS)[number];
export const GITHUB_STARS_INGESTION_SCHEMA_VERSION = 1;
export const GITHUB_STAR_REPOSITORIES = [
  'facebook/react',
  'angular/angular',
  'vuejs/core',
] as const;
export type GitHubStarRepository = (typeof GITHUB_STAR_REPOSITORIES)[number];
export const GITHUB_STAR_FRAMEWORKS = GOOGLE_TRENDS_FRAMEWORKS;
export type GitHubStarFramework = (typeof GITHUB_STAR_FRAMEWORKS)[number];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a real calendar date.');

const createRunBaseSchema = z.object({
  gitSha: z.string().trim().max(64).default(''),
  metadata: z.record(z.unknown()).default({}),
  sourceDataThrough: isoDateSchema,
});

const createRunSchema = createRunBaseSchema.extend({
  schemaVersion: z.literal(NPM_INGESTION_SCHEMA_VERSION),
});

const rowSchema = z.object({
  date: isoDateSchema,
  downloads: z.number().int().nonnegative().safe(),
  package: z.enum(NPM_PACKAGES),
});

const batchSchema = z.object({
  rows: z.array(rowSchema).min(1).max(1000),
});

const googleTrendsRowSchema = z.object({
  date: isoDateSchema,
  framework: z.enum(GOOGLE_TRENDS_FRAMEWORKS),
  interest: z.number().finite().min(0).max(100),
});

const googleTrendsBatchSchema = z.object({
  rows: z.array(googleTrendsRowSchema).min(1).max(1000),
});

const createGoogleTrendsRunSchema = createRunBaseSchema.extend({
  completedMonthBefore: isoDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Expected the first day of a calendar month.',
  ),
  schemaVersion: z.literal(GOOGLE_TRENDS_INGESTION_SCHEMA_VERSION),
});

const createGitHubStarsRunSchema = createRunBaseSchema.extend({
  completedMonthBefore: isoDateSchema.refine(
    (value) => value.endsWith('-01'),
    'Expected the first day of a calendar month.',
  ),
  schemaVersion: z.literal(GITHUB_STARS_INGESTION_SCHEMA_VERSION),
});

const gitHubStarsRowSchema = z.object({
  date: isoDateSchema,
  framework: z.enum(GITHUB_STAR_FRAMEWORKS),
  newStars: z.number().int().nonnegative().safe(),
  repository: z.enum(GITHUB_STAR_REPOSITORIES),
});

const gitHubStarsBatchSchema = z.object({
  rows: z.array(gitHubStarsRowSchema).min(1).max(1000),
});

const failRunSchema = z.object({
  error: z.string().trim().min(1).max(4000),
});

const uuidSchema = z.string().uuid();
const batchNumberSchema = z.coerce.number().int().nonnegative();

export type CreateNpmIngestionRunInput = z.infer<typeof createRunSchema>;
export type NpmIngestionBatchInput = z.infer<typeof batchSchema>;
export type FailNpmIngestionRunInput = z.infer<typeof failRunSchema>;
export type CreateGoogleTrendsIngestionRunInput = z.infer<typeof createGoogleTrendsRunSchema>;
export type GoogleTrendsIngestionBatchInput = z.infer<typeof googleTrendsBatchSchema>;
export type CreateGitHubStarsIngestionRunInput = z.infer<typeof createGitHubStarsRunSchema>;
export type GitHubStarsIngestionBatchInput = z.infer<typeof gitHubStarsBatchSchema>;

export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}

export function validateCreateNpmIngestionRun(
  input: unknown,
): CreateNpmIngestionRunInput {
  return validate(createRunSchema, input);
}

export function validateNpmIngestionBatch(input: unknown): NpmIngestionBatchInput {
  return validate(batchSchema, input);
}

export function validateCreateGoogleTrendsIngestionRun(
  input: unknown,
): CreateGoogleTrendsIngestionRunInput {
  return validate(createGoogleTrendsRunSchema, input);
}

export function validateGoogleTrendsIngestionBatch(
  input: unknown,
): GoogleTrendsIngestionBatchInput {
  return validate(googleTrendsBatchSchema, input);
}

export function validateCreateGitHubStarsIngestionRun(
  input: unknown,
): CreateGitHubStarsIngestionRunInput {
  return validate(createGitHubStarsRunSchema, input);
}

export function validateGitHubStarsIngestionBatch(
  input: unknown,
): GitHubStarsIngestionBatchInput {
  return validate(gitHubStarsBatchSchema, input);
}

export function validateFailNpmIngestionRun(
  input: unknown,
): FailNpmIngestionRunInput {
  return validate(failRunSchema, input);
}

export function validateRunId(input: unknown): string {
  return validate(uuidSchema, input);
}

export function validateBatchNumber(input: unknown): number {
  return validate(batchNumberSchema, input);
}

function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new IngestionValidationError(
      result.error.issues[0]?.message ?? 'Invalid ingestion payload.',
    );
  }

  return result.data;
}
