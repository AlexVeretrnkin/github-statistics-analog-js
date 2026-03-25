# github-statistics-analog-js

This project was generated with [Analog](https://analogjs.org), the fullstack meta-framework for Angular.

## Setup

Run `npm install` to install the application dependencies.

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
```

Environment variables are read through a shared config module, so the same values are used by both the Analog server route and GraphQL code generation.

## Development

Run `npm start` for a dev server. Navigate to `http://localhost:5173/`. The application automatically reloads if you change any of the source files.

## Build

Run `npm run build` to build the client/server project. The client build artifacts are located in the `dist/analog/public` directory. The server for the API build artifacts are located in the `dist/analog/server` directory.

## Test

Run `npm run test` to run unit tests with [Vitest](https://vitest.dev).

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
