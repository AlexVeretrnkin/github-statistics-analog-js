# github-statistics-analog-js

This project was generated with [Analog](https://analogjs.org), the fullstack meta-framework for Angular.

## Setup

Run `npm install` to install the application dependencies.

Create a `.env` file with:

```bash
GITHUB_TOKEN=ghp_your_token
```

Optional variables for GraphQL DX:

```bash
# Optional: use a previously downloaded schema snapshot instead of hitting GitHub directly.
GITHUB_GRAPHQL_SCHEMA_PATH=./schema/github.graphql
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
/api/v1/issues?owner=analogjs&repo=analog&first=10&states=OPEN
```

Supported query params:

- `owner` required
- `repo` required
- `first` optional, 1-100, defaults to `20`
- `states` optional, comma-separated `OPEN,CLOSED`, defaults to `OPEN`
- `after` optional cursor for pagination

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
