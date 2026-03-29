import type { PageServerLoad } from '@analogjs/router';

import { getAnalyzedRepositories } from '../../../server/services/gemini-label-analysis';

export const load = async (_context: PageServerLoad) => {
  return {
    repositories: getAnalyzedRepositories(),
  };
};
