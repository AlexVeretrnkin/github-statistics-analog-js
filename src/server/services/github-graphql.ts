import { createError } from 'h3';
import { print, type ExecutionResult } from 'graphql';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

import { getGitHubConfig, getRequiredGitHubToken } from '../../config/github';
import { repositoryIssuesDocument } from '../../graphql/github/issues';
import { repositoryLabelsDocument } from '../../graphql/github/labels';
import {
  buildIssuesCacheKey,
  buildLabelsCacheKey,
  readIssuesCache,
  readLabelsCache,
  saveRepositoryArchiveEntry,
  writeIssuesCache,
  writeLabelsCache,
} from '../lib/cache/github-cache';
import { type FetchRepositoryIssuesInput } from '../validation/issues-query';
import { type FetchRepositoryLabelsInput } from '../validation/labels-query';

interface MonthRange {
  start: string;
  end: string;
}

interface MonthlyIssueStats {
  month: string;
  total: number;
  open: number;
  closed: number;
}

async function executeGitHubGraphQl<
  TData,
  TVariables extends Record<string, unknown>,
>(
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
): Promise<TData> {
  const { graphqlEndpoint } = getGitHubConfig();

  let token: string;

  try {
    token = getRequiredGitHubToken();
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing GITHUB_TOKEN environment variable.',
    });
  }

  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'github-statistics-analog-js',
    },
    body: JSON.stringify({ query: print(document), variables }),
  });

  const payload = (await response.json()) as ExecutionResult<TData>;

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage:
        payload.errors?.map((error) => error.message).join('; ') ??
        'GitHub GraphQL request failed.',
    });
  }

  if (payload.errors?.length) {
    throw createError({
      statusCode: 502,
      statusMessage: payload.errors.map((error) => error.message).join('; '),
    });
  }

  if (!payload.data) {
    throw createError({
      statusCode: 502,
      statusMessage: 'GitHub GraphQL response did not include data.',
    });
  }

  return payload.data;
}

export async function fetchRepositoryIssues({
  owner,
  repo,
  from,
  to,
  labels,
}: FetchRepositoryIssuesInput) {
  const cacheKey = buildIssuesCacheKey({
    owner,
    repo,
    from,
    to,
    labels,
  });
  const cachedResponse = readIssuesCache<{
    from: string;
    to: string;
    repository: {
      id: string;
      name: string;
      owner: string;
    };
    labels: string[];
    months: MonthlyIssueStats[];
  }>(cacheKey);

  if (cachedResponse) {
    saveRepositoryArchiveEntry({
      owner,
      repo,
      repositoryId: cachedResponse.repository.id,
    });

    return cachedResponse;
  }

  const monthRanges = getMonthRanges(from, to);
  const labelFilter = buildLabelFilter(labels ?? []);

  const monthlyData = await Promise.all(
    monthRanges.map(async ({ month, range }) => {
      const data = await executeGitHubGraphQl(repositoryIssuesDocument, {
        owner,
        repo,
        monthlyIssuesQuery: buildIssuesSearchQuery({
          owner,
          repo,
          monthRange: range,
          labelFilter,
        }),
        monthlyOpenIssuesQuery: buildIssuesSearchQuery({
          owner,
          repo,
          monthRange: range,
          labelFilter,
          state: 'open',
        }),
        monthlyClosedIssuesQuery: buildIssuesSearchQuery({
          owner,
          repo,
          monthRange: range,
          labelFilter,
          state: 'closed',
        }),
      });

      if (!data.repository) {
        throw createError({
          statusCode: 404,
          statusMessage: `Repository ${owner}/${repo} was not found.`,
        });
      }

      return {
        month,
        repository: data.repository,
        total: data.monthlyIssues.issueCount,
        open: data.monthlyOpenIssues.issueCount,
        closed: data.monthlyClosedIssues.issueCount,
      };
    }),
  );

  const repository = monthlyData[0]?.repository;

  if (!repository) {
    throw createError({
      statusCode: 404,
      statusMessage: `Repository ${owner}/${repo} was not found.`,
    });
  }

  const response = {
    from,
    to,
    repository: {
      id: repository.id,
      name: repository.name,
      owner: repository.owner.login,
    },
    labels: labels ?? [],
    months: monthlyData.map(({ month, total, open, closed }): MonthlyIssueStats => ({
      month,
      total,
      open,
      closed,
    })),
  };

  saveRepositoryArchiveEntry({
    owner,
    repo,
    repositoryId: response.repository.id,
  });

  writeIssuesCache(cacheKey, response);

  return response;
}

const getMonthRange = (month: string): MonthRange => {
  const [year, monthIndex] = month.split('-').map(Number);

  if (!year || !monthIndex || monthIndex < 1 || monthIndex > 12) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Month must be in YYYY-MM format.',
    });
  }

  const start = new Date(Date.UTC(year, monthIndex - 1, 1));
  const end = new Date(Date.UTC(year, monthIndex, 0));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const getMonthRanges = (
  from: string,
  to: string,
): Array<{ month: string; range: MonthRange }> => {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const ranges: Array<{ month: string; range: MonthRange }> = [];

  let year = fromYear;
  let month = fromMonth;

  while (year < toYear || (year === toYear && month <= toMonth)) {
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    ranges.push({
      month: monthLabel,
      range: getMonthRange(monthLabel),
    });

    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return ranges;
};

const escapeSearchValue = (value: string): string =>
  JSON.stringify(value.trim());

const buildIssuesSearchQuery = ({
  owner,
  repo,
  monthRange,
  labelFilter,
  state,
}: {
  owner: string;
  repo: string;
  monthRange: MonthRange;
  labelFilter: string | null;
  state?: 'open' | 'closed';
}): string =>
  [
    'is:issue',
    `repo:${owner}/${repo}`,
    `created:${monthRange.start}..${monthRange.end}`,
    labelFilter,
    state ? `state:${state}` : null,
  ]
    .filter(Boolean)
    .join(' ');

const buildLabelFilter = (labels: string[]): string | null => {
  if (labels.length === 0) {
    return null;
  }

  return `label:${labels.map(escapeSearchValue).join(',')}`;
};

interface RepositoryLabelsPage {
  repository: {
    id: string;
    name: string;
    owner: {
      login: string;
    };
    labels: {
      totalCount: number;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: Array<{
        id: string;
        name: string;
        color: string;
        description: string | null;
      } | null> | null;
    };
  } | null;
}

export async function fetchRepositoryLabels({
  owner,
  repo,
}: FetchRepositoryLabelsInput) {
  const cacheKey = buildLabelsCacheKey({ owner, repo });
  const cachedResponse = readLabelsCache<{
    repository: {
      id: string;
      name: string;
      owner: string;
    };
    totalCount: number;
    labels: Array<{
      id: string;
      name: string;
      color: string;
      description: string | null;
    }>;
  }>(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  const labels: Array<{
    id: string;
    name: string;
    color: string;
    description: string | null;
  }> = [];

  let after: string | undefined;
  let repository:
    | {
        id: string;
        name: string;
        owner: {
          login: string;
        };
      }
    | undefined;
  let totalCount = 0;

  do {
    const data = await executeGitHubGraphQl<
      RepositoryLabelsPage,
      {
        owner: string;
        repo: string;
        first: number;
        after?: string;
      }
    >(repositoryLabelsDocument as TypedDocumentNode<RepositoryLabelsPage, {
      owner: string;
      repo: string;
      first: number;
      after?: string;
    }>, {
      owner,
      repo,
      first: 100,
      after,
    });

    if (!data.repository) {
      throw createError({
        statusCode: 404,
        statusMessage: `Repository ${owner}/${repo} was not found.`,
      });
    }

    repository = {
      id: data.repository.id,
      name: data.repository.name,
      owner: data.repository.owner,
    };
    totalCount = data.repository.labels.totalCount;

    labels.push(
      ...(data.repository.labels.nodes?.flatMap((label) =>
        label
          ? [
              {
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description,
              },
            ]
          : [],
      ) ?? []),
    );

    after = data.repository.labels.pageInfo.hasNextPage
      ? data.repository.labels.pageInfo.endCursor ?? undefined
      : undefined;
  } while (after);

  if (!repository) {
    throw createError({
      statusCode: 404,
      statusMessage: `Repository ${owner}/${repo} was not found.`,
    });
  }

  const response = {
    repository: {
      id: repository.id,
      name: repository.name,
      owner: repository.owner.login,
    },
    totalCount,
    labels,
  };

  writeLabelsCache(cacheKey, response);

  return response;
}
