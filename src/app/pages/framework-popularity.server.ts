import type { PageServerLoad } from '@analogjs/router';

import { getFrameworkPopularityResearch } from '../../server/services/framework-popularity';

export const load = async (_context: PageServerLoad) => ({
  research: await getFrameworkPopularityResearch(),
});
