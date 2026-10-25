# syntax=docker/dockerfile:1
#
# Production image for explorador advance (apps/web: Next.js 16 + Prisma 7) on
# explorador's AWS swarm: stack `advance`, service `web` (deploy/stack-aws.yml),
# built and rolled out by deploy-aws.sh. The build context is the repo root
# (the pnpm workspace):
#
#   docker build -f deploy/Dockerfile -t advance-web:local .
#
# CI builds with --platform linux/amd64, the swarm's architecture.
#
#   deps        pnpm install for apps/web (cached until a manifest, the lockfile or the Prisma schema changes)
#   prisma-cli  the Prisma CLI copied from that install + schema, migrations and prisma.config.ts,
#               for `prisma migrate deploy` at container start
#   builder     prisma generate + next build with output: standalone (BUILD_STANDALONE=1), then
#               /out = the traced server + static assets + public/ + zk/ circuit artifacts
#   runner      Debian slim + those trees, non-root; docker-entrypoint.sh migrates, then starts server.js
#
# No build args: the app reads no NEXT_PUBLIC_* variable. All config is
# server-side and comes from the container environment at runtime.

ARG NODE_IMAGE=node:24.22.1-trixie-slim

# Node 24.22.1 is the version .npmrc pins (use-node-version). .npmrc itself is
# never copied in: pnpm would download a second copy of that Node.
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1

FROM base AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
# Every workspace manifest: a frozen install checks the lockfile against all of them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY circuits/package.json circuits/
COPY packages/contracts-ts/package.json packages/contracts-ts/
COPY scripts/package.json scripts/
# apps/web's postinstall runs `prisma generate`, which needs the schema and config.
COPY apps/web/prisma apps/web/prisma
COPY apps/web/prisma.config.ts apps/web/
# Only apps/web's dependencies (circuits/ and scripts/ are local tools). The
# @prisma/engines postinstall downloads the schema engine for this platform:
# debian-openssl-3.0.x, detected from the image's libssl3.
RUN --mount=type=cache,id=advance-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web --store-dir /pnpm/store

FROM deps AS prisma-cli
# The CLI is a devDependency, so the standalone trace never has it. Copy what
# pnpm installed (lockfile versions, Linux schema engine included), plus dotenv
# for prisma.config.ts, the schema and the migrations. TypeScript is an
# optional peer the CLI doesn't need (prisma.config.ts is loaded by jiti);
# Studio and `prisma dev` can't be left out: the CLI loads them on start.
# The smoke test runs the shipped CLI, config and schema engine without a
# database: a missing module or an engine built for the wrong libssl fails the
# build here instead of the container start.
COPY deploy/copy-pnpm-closure.mjs deploy/
RUN node deploy/copy-pnpm-closure.mjs --exclude=typescript /app apps/web /out prisma dotenv \
 && cp -a apps/web/prisma apps/web/prisma.config.ts /out/apps/web/ \
 && cd /out/apps/web \
 && DATABASE_URL=postgresql://build@127.0.0.1:1/unused node node_modules/prisma/build/index.js \
      migrate diff --from-empty --to-schema prisma/schema.prisma --script > /dev/null

FROM deps AS builder
COPY apps/web apps/web
# Regenerate in case the context carried a stale lib/generated (.dockerignore excludes it).
RUN pnpm --filter web exec prisma generate \
 && BUILD_STANDALONE=1 pnpm --filter web build
# The standalone tree keeps the monorepo layout: server.js lands in apps/web,
# next to its .next/, with the traced node_modules at the root. Static assets
# and public/ aren't traced; zk/ is (outputFileTracingIncludes) but is copied
# whole here so the artifacts never depend on the trace.
RUN mkdir -p /out \
 && cp -a apps/web/.next/standalone/. /out/ \
 && cp -a apps/web/.next/static /out/apps/web/.next/static \
 && cp -a apps/web/public /out/apps/web/public \
 && rm -rf /out/apps/web/zk \
 && cp -a apps/web/zk /out/apps/web/zk

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_EXTRA_CA_CERTS=/usr/local/share/rds/global-bundle.pem
# Amazon RDS certificate authorities, so node-postgres can verify the database
# certificate (DATABASE_URL …?sslmode=verify-full). Node trusts these on top of
# its own bundle; nothing else changes. The directory is made first: ADD
# --chmod would give the parents it creates mode 644 too, and an untraversable
# /etc/ssl stops Node at startup (it reads /etc/ssl/openssl.cnf).
RUN mkdir -p -m 755 /usr/local/share/rds
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds/global-bundle.pem
WORKDIR /app/apps/web
# Least-changing layers first: the Prisma CLI (+ schema and migrations) moves
# only with the lockfile or the schema.
COPY --from=prisma-cli /out/ /app/
# deployments/testnet.json: the contract ids to use until the database has an
# active Deployment row (lib/stellar/deployment.ts reads ../../deployments from here).
COPY deployments /app/deployments
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY --from=builder /out/ /app/
# The code stays root-owned and read-only; Next.js only writes its cache.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
