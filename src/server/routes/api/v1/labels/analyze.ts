import { defineEventHandler, getValidatedQuery } from 'h3';

import { analyzeRepositoryLabels } from '../../../../services/gemini-label-analysis';
import { validateLabelAnalysisQuery } from '../../../../validation/label-analysis-query';

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, validateLabelAnalysisQuery);

  return analyzeRepositoryLabels(query);
});
