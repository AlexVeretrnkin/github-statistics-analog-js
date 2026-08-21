import { env } from './env';

export interface ResearchDatabaseConfig {
  connectionString?: string;
  readsEnabled: boolean;
}

export function getResearchDatabaseConfig(): ResearchDatabaseConfig {
  return {
    connectionString: env.DATABASE_URL,
    readsEnabled: parseBoolean(env.FRAMEWORK_RESEARCH_DB_READS),
  };
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}
