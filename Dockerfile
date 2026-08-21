FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ingestion-api/package.json ./apps/ingestion-api/package.json
COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json
COPY packages/research-database/package.json ./packages/research-database/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .

RUN pnpm build

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/dist ./dist
COPY --from=build /app/research ./research

EXPOSE 8080

CMD ["node", "dist/analog/server/index.mjs"]
