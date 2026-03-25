import type { PageServerLoad } from '@analogjs/router';
import { createError } from 'h3';

import { getAnalyzedRepositoryDetails } from '../../../../server/services/gemini-label-analysis';

export const load = async ({ params }: PageServerLoad) => {
  const owner = String(params?.['owner'] ?? '').trim();
  const repo = String(params?.['repo'] ?? '').trim();
  const analysis = getAnalyzedRepositoryDetails({ owner, repo });

  if (!analysis) {
    throw createError({
      statusCode: 404,
      statusMessage: `No saved analysis found for ${owner}/${repo}.`,
    });
  }

  return {
    analysis,
  };
};
