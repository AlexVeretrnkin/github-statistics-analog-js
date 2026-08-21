# Ingestion API

Private Cloud Run service that accepts validated research batches and publishes them to
PostgreSQL. It is a separate application and container from the public Analog website.

## Runtime

- `DATABASE_URL` is required and must use a direct connection with migration/write privileges.
- `PORT` defaults to `8080`.
- Drizzle migrations run before the HTTP listener starts.
- Cloud Run IAM is the authentication boundary; only the GitHub OIDC invoker receives
  `roles/run.invoker`.

Build from the repository root with `pnpm build:ingestion` or
`docker build -f Dockerfile.ingestion .`.

For local development, `pnpm local:dev` starts PostgreSQL plus the native service, while
`pnpm local:up` builds and starts the complete containerized stack. Local traffic is deliberately
unauthenticated because Cloud Run IAM is not present, so the API port is bound to loopback only.
Use `pnpm local:smoke` for a fast deterministic end-to-end check.

The service exposes `/healthz` and the versioned routes under
`/api/internal/v1/ingestions/npm-downloads`. The full contract and deployment runbook are in
`docs/research-ingestion-architecture.md`.
