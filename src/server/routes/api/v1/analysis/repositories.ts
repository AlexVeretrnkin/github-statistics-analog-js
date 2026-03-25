import { defineEventHandler } from 'h3';

import { getAnalyzedRepositories } from '../../../../services/gemini-label-analysis';

export default defineEventHandler(() => getAnalyzedRepositories());
