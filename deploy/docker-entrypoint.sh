#!/bin/sh
# Container start for explorador advance (deploy/Dockerfile): apply pending
# Prisma migrations, then exec the server (CMD: node server.js). Runs from
# /app/apps/web, where prisma.config.ts, prisma/ and server.js live.
#
# Runtime config is the container environment: on the swarm, the service's
# env_file (web.env, written from Secrets Manager prod-advance-web-env by
# deploy-aws.sh). Nothing is read from an env file inside the image.
set -e

# Without DATABASE_URL the app and prisma.config.ts fall back to the local
# docker compose Postgres (localhost:5433): fail loudly instead.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "docker-entrypoint: DATABASE_URL is not set; refusing to start" >&2
  exit 1
fi

# `migrate deploy` applies committed migrations only (never resets or drops)
# and holds a Postgres advisory lock, so two containers starting together
# apply them once. A failure exits here, before the server starts: the swarm
# restarts the task and rolls a failed update back. Migrations must stay
# additive, because the previous version keeps serving during a start-first
# rollout. SKIP_MIGRATIONS=1 starts the server without migrating.
if [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  echo "docker-entrypoint: SKIP_MIGRATIONS=1, not migrating"
else
  echo "docker-entrypoint: applying database migrations"
  node node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
