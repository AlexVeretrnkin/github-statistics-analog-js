import { z } from 'zod';

export const NPM_INGESTION_SCHEMA_VERSION = 1;
export const NPM_PACKAGES = ['react', '@angular/core', 'vue'] as const;
export type NpmPackage = (typeof NPM_PACKAGES)[number];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected an ISO date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Expected a real calendar date.');

const createRunSchema = z.object({
  gitSha: z.string().trim().max(64).default(''),
  metadata: z.record(z.unknown()).default({}),
  schemaVersion: z.literal(NPM_INGESTION_SCHEMA_VERSION),
  sourceDataThrough: isoDateSchema,
});

const rowSchema = z.object({
  date: isoDateSchema,
  downloads: z.number().int().nonnegative().safe(),
  package: z.enum(NPM_PACKAGES),
});

const batchSchema = z.object({
  rows: z.array(rowSchema).min(1).max(1000),
});

const failRunSchema = z.object({
  error: z.string().trim().min(1).max(4000),
});

const uuidSchema = z.string().uuid();
const batchNumberSchema = z.coerce.number().int().nonnegative();

export type CreateNpmIngestionRunInput = z.infer<typeof createRunSchema>;
export type NpmIngestionBatchInput = z.infer<typeof batchSchema>;
export type FailNpmIngestionRunInput = z.infer<typeof failRunSchema>;

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
