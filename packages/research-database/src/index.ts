export { closeResearchDatabase, getResearchDatabase } from './client.js';
export { ensureResearchDatabaseSchema } from './migrations.js';
export * from './schema.js';
export {
  commitGitHubStarsIngestionRun,
  createGitHubStarsIngestionRun,
  failGitHubStarsIngestionRun,
  getGitHubStarsIngestionCheckpoint,
  writeGitHubStarsIngestionBatch,
  type GitHubStarsIngestionCheckpoint,
} from './github-stars-ingestion.js';
export {
  commitGoogleTrendsIngestionRun,
  createGoogleTrendsIngestionRun,
  failGoogleTrendsIngestionRun,
  getGoogleTrendsIngestionCheckpoint,
  writeGoogleTrendsIngestionBatch,
  type GoogleTrendsIngestionCheckpoint,
} from './google-trends-ingestion.js';
export {
  commitNpmIngestionRun,
  createNpmIngestionRun,
  failNpmIngestionRun,
  getNpmIngestionCheckpoint,
  IngestionStateError,
  writeNpmIngestionBatch,
  type NpmIngestionCheckpoint,
} from './npm-ingestion.js';
export {
  listGitHubStarsMonthly,
  listGoogleTrendsMonthly,
  listNpmMonthlyDownloads,
  type GitHubStarsMonthlyDatabaseRow,
  type GoogleTrendsMonthlyDatabaseRow,
  type NpmMonthlyDatabaseRow,
} from './read.js';
