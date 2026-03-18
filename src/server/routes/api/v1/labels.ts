import { defineEventHandler, getValidatedQuery } from 'h3';

import { fetchRepositoryLabels } from '../../../services/github-graphql';
import { validateLabelsQuery } from '../../../validation/labels-query';

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, validateLabelsQuery);

  return fetchRepositoryLabels(query);
});
