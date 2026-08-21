# Research database

Shared Drizzle ORM package for research persistence. It contains the PostgreSQL schema,
generated migrations, read queries used by the public web app, and transactional ingestion
operations used by the private writer.

The TypeScript schema in `src/schema.ts` is the source of truth. After changing it, run from the
repository root:

```bash
pnpm --filter @github-statistics/research-database db:generate
pnpm --filter @github-statistics/research-database db:check
```

Review and commit the generated files under `drizzle/`. Production schema changes must use
versioned migrations; do not use `drizzle-kit push` against Neon production.
