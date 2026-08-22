# github-statistics-analog-js

This project was generated with [Analog](https://analogjs.org), the fullstack meta-framework for Angular.

## Setup

This repository is a pnpm workspace monorepo. Run `pnpm install` to install all workspace
dependencies.

Use Node.js `22.13.0` or newer because the app relies on the built-in `node:sqlite` module.

Create a `.env` file with:

```bash
GITHUB_TOKEN=ghp_your_token
```

Optional variables:

```bash
# Optional: use a previously downloaded schema snapshot instead of hitting GitHub directly.
GITHUB_GRAPHQL_SCHEMA_PATH=./schema/github.graphql

# Optional: SQLite cache location and TTL values (defaults to 10 days).
GITHUB_CACHE_DB_PATH=.data/github-cache.sqlite
GITHUB_ISSUES_CACHE_TTL_MS=864000000
GITHUB_LABELS_CACHE_TTL_MS=864000000

# Optional Gemini label analysis settings.
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_LABEL_ANALYSIS_CACHE_TTL_MS=2592000000

# Optional PostgreSQL research persistence.
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
FRAMEWORK_RESEARCH_DB_READS=false
```

Environment variables are read through a shared config module, so the same values are used by both the Analog server route and GraphQL code generation.

## Development

Run `pnpm start` for a dev server. Navigate to `http://localhost:5173/`. The application automatically reloads if you change any of the source files.

### Complete local environment

The local environment uses PostgreSQL in Docker and never connects to Neon. Start the database,
compiled ingestion service, and Vite web server with:

```bash
cp .env.local.example .env.local # required once on a fresh clone
pnpm local:dev
```

Then, from another terminal, publish a small deterministic dataset through the real HTTP and
Drizzle transaction path:

```bash
pnpm local:smoke
```

The web application is at `http://127.0.0.1:8080`, the private API is at
`http://127.0.0.1:8081`, and PostgreSQL is exposed locally on port `5433`. Stop the application
processes with Ctrl-C and PostgreSQL with `pnpm local:down`.

To test the production-style containers instead of native Node processes:

```bash
pnpm local:up
pnpm local:status
pnpm local:smoke
pnpm local:logs
pnpm local:down
```

`pnpm local:reset` additionally deletes the local PostgreSQL and SQLite volumes. Use it only when
you intentionally want a clean bootstrap.

After installing the documented R dependencies, `pnpm local:pipeline:npm` runs the real npm
collector and publisher against the local ingestion API. On a fresh database it backfills from
2015 and therefore takes considerably longer than `local:smoke`.

Compare the canonical database rows produced by that run with the original archived CSV output:

```bash
pnpm local:compare:npm
pnpm local:compare:npm:strict
```

The comparison checks both daily observations and monthly aggregates over each package's common
date range. The normal command prints coverage and representative differences; the strict command
also exits unsuccessfully when a row is missing, extra, or has a different download count. Data
outside the common range is reported as coverage rather than treated as a mismatch; having no
common coverage is a strict-mode error. Run the comparison before `pnpm local:smoke` when you need
an uncontaminated real-data result, because the smoke command deliberately inserts synthetic
observations.

## Build

Run `pnpm build:web` for the public client/server application, `pnpm build:ingestion` for the
private writer, or `pnpm build:all` for both.

The workspace boundary is:

- `src/` — public Analog application (`@github-statistics/web`)
- `apps/ingestion-api/` — private database writer (`@github-statistics/ingestion-api`)
- `packages/ingestion-contracts/` — shared versioned request contracts
- `packages/research-database/` — shared Drizzle ORM schema, migrations, and repositories

## Docker

Build and run both production containers plus local PostgreSQL with Docker Compose:

```bash
pnpm local:up
```

The web app is available at `http://localhost:8080`; the ingestion API is available at
`http://localhost:8081` and requires `DATABASE_URL`.

- `compose.yaml` loads local defaults from `.env.local`
- the SQLite cache is mounted to a named Docker volume at `/app/.data`
- PostgreSQL uses its own named volume and never reads the Neon connection string
- all published host ports bind to `127.0.0.1`
- stop the stack with `pnpm local:down`

## Test

Run `pnpm test` to run the browser/server and workspace Node tests with [Vitest](https://vitest.dev).

## GitHub GraphQL

The project exposes an Analog server route at `/api/v1/issues` that proxies requests to the GitHub GraphQL API. Example:

```text
/api/v1/issues?owner=facebook&repo=react&from=2025-01&to=2025-12&labels=bug,good%20first%20issue
```

Supported query params:

- `owner` required
- `repo` required
- `from` required, `YYYY-MM`
- `to` required, `YYYY-MM`
- `labels` optional, comma-separated list interpreted with `OR` semantics

GitHub API responses are cached in a local SQLite database by default:

- the cache uses Node's built-in `node:sqlite` module, so no external SQLite driver is required
- database path defaults to `.data/github-cache.sqlite`
- `issues` responses use a default TTL of 10 days
- `labels` responses use a default TTL of 10 days
- repeated requests with the same normalized parameters are served from SQLite until the TTL expires

## JavaScript Framework Popularity Research

The consolidated research dashboard is available at `/framework-popularity`. It
compares React, Angular, and Vue using three archived monthly signals:

- Google Trends interest in the web-frameworks category
- npm package downloads
- new GitHub stars per month

The original R collection, transformation, ARIMA/ETS/Prophet forecasting, diagnostics,
datasets, and generated evidence live in `research/framework-popularity`. npm is the
first source migrated to scheduled PostgreSQL ingestion; the remaining signals and
forecasts continue to use archived inputs during the migration.

Refresh npm, Google Trends, and GitHub stars plus all ARIMA, ETS, and Prophet
forecasts with `pnpm research:refresh`. Use `pnpm research:refresh:stars` for the
GitHub snapshot source alone. Use `pnpm research:setup` once to install the required
R packages. The `Ingest npm downloads` GitHub Actions workflow now publishes validated
npm batches to an IAM-protected Cloud Run ingestion endpoint using OIDC. The legacy CSV
workflow is manual-only.

The complete design, schema, authentication flow, endpoint contract, deployment setup,
failure behavior, and migration roadmap are documented in
[`docs/research-ingestion-architecture.md`](docs/research-ingestion-architecture.md).

Research persistence uses Drizzle ORM with a typed PostgreSQL schema and generated migrations.
The public application contains database reads only; its container does not include the private
ingestion server.

## Gemini Label Analysis

The project also exposes `/api/v1/labels/analyze?owner=...&repo=...` for research-oriented label categorization.

- the route calls the Gemini API with JSON-schema-based structured output
- `technical_debt` is treated as a predefined research category
- the model can still suggest emergent categories beyond the predefined list
- results are cached in the same SQLite database, with a default TTL of 30 days
- use `refresh=true` to force re-analysis when needed

GraphQL developer tooling:

- `pnpm graphql:codegen` loads variables from `.env` and generates typed GraphQL helpers from files in `src/graphql/**/*.{graphql,ts}`
- `pnpm graphql:codegen` also refreshes the local `schema.graphql` file used by GraphQLSP for inline autocomplete and validation in `graphql(\`...\`)`
- `GITHUB_TOKEN` is used to fetch the GitHub schema directly when no local schema snapshot is configured
- `GITHUB_GRAPHQL_SCHEMA_PATH` lets you point codegen to a local schema file if you prefer not to introspect GitHub during generation

For editor hints inside `graphql(\`...\`)` templates:

- write documents as `graphql(/* GraphQL */ \`...\`)`, because Codegen plucks operations from the `GraphQL` magic comment
- make sure `pnpm graphql:codegen` has been run at least once so `schema.graphql` exists
- in VS Code, switch to the workspace TypeScript version when prompted
- the project already enables `@0no-co/graphqlsp` in `tsconfig.json`, which powers GraphQL autocomplete, validation, and hover info

## Community

- Visit and Star the [GitHub Repo](https://github.com/analogjs/analog)
- Join the [Discord](https://chat.analogjs.org)
- Follow us on [Twitter](https://twitter.com/analogjs)
- Become a [Sponsor](https://github.com/sponsors/brandonroberts)
