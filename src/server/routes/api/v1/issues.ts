import { defineEventHandler, getValidatedQuery } from 'h3';

import { fetchRepositoryIssues } from '../../../services/github-graphql';
import { validateIssuesQuery } from '../../../validation/issues-query';

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, validateIssuesQuery);

  return fetchRepositoryIssues(query);
});
