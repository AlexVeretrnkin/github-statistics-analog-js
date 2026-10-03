import { describe, expect, it } from 'vitest';

import {
  validateBatchNumber,
  validateCreateGoogleTrendsIngestionRun,
  validateCreateGitHubStarsIngestionRun,
  validateCreateNpmIngestionRun,
  validateGoogleTrendsIngestionBatch,
  validateGitHubStarsIngestionBatch,
  validateNpmIngestionBatch,
  validateRunId,
} from './index.js';

describe('GitHub stars ingestion validation', () => {
  it('accepts only tracked repository/framework rows with nonnegative integer counts', () => {
    expect(validateCreateGitHubStarsIngestionRun({
      completedMonthBefore: '2026-09-01',
      schemaVersion: 1,
      sourceDataThrough: '2026-09-16',
    })).toMatchObject({ schemaVersion: 1, sourceDataThrough: '2026-09-16' });

    expect(validateGitHubStarsIngestionBatch({
      rows: [{
        date: '2026-09-16',
        framework: 'React',
        newStars: 42,
        repository: 'facebook/react',
      }],
    }).rows).toHaveLength(1);
    expect(() => validateGitHubStarsIngestionBatch({
      rows: [{
        date: '2026-09-16',
        framework: 'React',
        newStars: 42,
        repository: 'sveltejs/svelte',
      }],
    })).toThrow();
    expect(() => validateGitHubStarsIngestionBatch({
      rows: [{
        date: '2026-09-16',
        framework: 'React',
        newStars: -1,
        repository: 'facebook/react',
      }],
    })).toThrow();
  });
});

describe('Google Trends ingestion validation', () => {
  it('accepts only tracked frameworks and interest values on the 0-100 scale', () => {
    expect(validateCreateGoogleTrendsIngestionRun({
      completedMonthBefore: '2026-08-01',
      schemaVersion: 1,
      sourceDataThrough: '2026-08-16',
    })).toMatchObject({ schemaVersion: 1, sourceDataThrough: '2026-08-16' });

    expect(validateGoogleTrendsIngestionBatch({
      rows: [{ framework: 'React', date: '2026-08-16', interest: 42.5 }],
    }).rows).toHaveLength(1);
    expect(() => validateGoogleTrendsIngestionBatch({
      rows: [{ framework: 'Svelte', date: '2026-08-16', interest: 42 }],
    })).toThrow();
    expect(() => validateGoogleTrendsIngestionBatch({
      rows: [{ framework: 'React', date: '2026-08-16', interest: 101 }],
    })).toThrow();
  });
});

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
