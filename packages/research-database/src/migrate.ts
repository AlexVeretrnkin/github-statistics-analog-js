import { closeResearchDatabase } from './client.js';
import { applyMigrations } from './migrations.js';

try {
  await applyMigrations();
  console.log('Research database migrations completed.');
} finally {
  await closeResearchDatabase();
}
