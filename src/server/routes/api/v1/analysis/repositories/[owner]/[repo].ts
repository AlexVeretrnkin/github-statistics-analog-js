import { createError, defineEventHandler, getRouterParams } from 'h3';

import { getAnalyzedRepositoryDetails } from '../../../../../../services/gemini-label-analysis';
import { validateRepositoryAnalysisDetailParams } from '../../../../../../validation/repository-analysis-detail-query';

export default defineEventHandler((event) => {
  const params = validateRepositoryAnalysisDetailParams(getRouterParams(event));
  const analysis = getAnalyzedRepositoryDetails(params);

  if (!analysis) {
    throw createError({
      statusCode: 404,
      statusMessage: `No saved analysis found for ${params.owner}/${params.repo}.`,
    });
  }

  return analysis;
});
