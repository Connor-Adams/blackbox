# syntax=docker/dockerfile:1.7
#
# Prebuilt production image for the blackbox Next.js app. Mirrors cashflow's
# backend Dockerfile (multi-stage node:22-slim, corepack, migrate-then-start
# CMD), collapsed to a single pnpm service.
#
# The runner deliberately keeps the FULL node_modules (dev deps included): the
# startup CMD runs `pnpm db:migrate` (drizzle-kit), and drizzle-kit is a
# devDependency. Pruning to prod-only would break migrations. We do NOT use
# Next's `output: standalone` for the same reason — drizzle-kit + drizzle.config.ts
# must be present at runtime.

FROM node:22-slim AS builder
WORKDIR /app

# Match the pnpm that generated pnpm-lock.yaml (lockfileVersion 9.0). The repo
# has no `packageManager` field, so pin explicitly here rather than relying on
# corepack's bundled default.
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo and build.
COPY . .
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production

# Everything the runtime needs:
#   .next            - the prebuilt Next.js output (`pnpm start` serves this)
#   public           - static assets
#   package.json     - scripts (start, db:migrate) + dep metadata
#   pnpm-lock.yaml   - lockfile (kept alongside node_modules for parity)
#   node_modules     - full tree incl. drizzle-kit (db:migrate) and next (start)
#   drizzle          - generated SQL migrations applied by db:migrate
#   drizzle.config.ts- drizzle-kit config (reads DATABASE_URL, points at lib/db/schema.ts)
#   tsconfig.json    - drizzle-kit loads the TS config; keep it resolvable
#   next.config.ts   - Next runtime config
#   lib              - drizzle.config.ts imports lib/db/schema.ts at load time
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/lib ./lib

EXPOSE 3000

# Run pending DB migrations, then start the server — mirrors cashflow backend's
# `db:migrate && exec node dist/server.js`. drizzle-kit migrate is idempotent.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
