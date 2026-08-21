import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let queryClient: ReturnType<typeof postgres> | undefined;
let database: PostgresJsDatabase | undefined;

export type ResearchDatabase = PostgresJsDatabase;

export function getResearchDatabase(): ResearchDatabase {
  if (database) {
    return database;
  }

  const connectionString = process.env['DATABASE_URL']?.trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for framework-research persistence.');
  }

  queryClient = postgres(connectionString, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 4,
  });
  database = drizzle(queryClient);

  return database;
}

export async function closeResearchDatabase(): Promise<void> {
  if (!queryClient) {
    return;
  }

  const currentClient = queryClient;
  queryClient = undefined;
  database = undefined;
  await currentClient.end({ timeout: 5 });
}
