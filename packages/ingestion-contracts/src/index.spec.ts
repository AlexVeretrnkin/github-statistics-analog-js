import { describe, expect, it } from 'vitest';

import {
  validateBatchNumber,
  validateCreateNpmIngestionRun,
  validateNpmIngestionBatch,
  validateRunId,
} from './index.js';

describe('npm ingestion validation', () => {
  it('normalizes a valid run request', () => {
    expect(validateCreateNpmIngestionRun({
      schemaVersion: 1,
      sourceDataThrough: '2026-08-18',
    })).toEqual({
      gitSha: '',
      metadata: {},
      schemaVersion: 1,
      sourceDataThrough: '2026-08-18',
    });
  });

  it('accepts only tracked npm packages and nonnegative integer counts', () => {
    expect(validateNpmIngestionBatch({
      rows: [{ package: 'react', date: '2026-08-18', downloads: 42 }],
    }).rows).toHaveLength(1);

    expect(() => validateNpmIngestionBatch({
      rows: [{ package: 'rxjs', date: '2026-08-18', downloads: 42 }],
    })).toThrow();
    expect(() => validateNpmIngestionBatch({
      rows: [{ package: 'react', date: '2026-08-18', downloads: -1 }],
    })).toThrow();
    expect(() => validateNpmIngestionBatch({
      rows: [{ package: 'react', date: '2026-02-30', downloads: 42 }],
    })).toThrow();
  });

  it('validates route identifiers', () => {
    expect(validateRunId('a8960a3f-2fbe-4d3f-a84f-0d9bab14c773'))
      .toBe('a8960a3f-2fbe-4d3f-a84f-0d9bab14c773');
    expect(validateBatchNumber('12')).toBe(12);
    expect(() => validateBatchNumber('-1')).toThrow();
  });
});
