#!/usr/bin/env bash
#
# vps-deploy.sh — deploy AutoDevSecOps AI to a production VPS (Docker Compose mode).
#
# Review before running. Designed to be idempotent: safe to re-run after changes.
# Prerequisites on the VPS: Docker + Compose plugin, git, curl, a non-root user
# able to run docker (sudo usermod -aG docker $USER), and Nginx + Certbot for TLS.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autodevsecops-ai}"
REPO="${REPO:-https://github.com/fairpirate/autodevsecops-ai.git}"
BRANCH="${BRANCH:-main}"
ENV_EXAMPLE="infrastructure/env/production.env.example"

log()  { printf '[vps-deploy] %s\n' "$*"; }
die()  { printf '[vps-deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker   >/dev/null || die "docker is not installed"
command -v node     >/dev/null || die "node is not installed (need >=20.11)"
command -v npx      >/dev/null || die "npx is not available"
docker compose version >/dev/null 2>&1 || die "docker compose plugin is not installed"

# ---------------------------------------------------------------------------
# 1. Source
# ---------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Updating existing checkout at $APP_DIR"
  git -C "$APP_DIR" fetch --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only
else
  log "Cloning $REPO (branch $BRANCH) into $APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"

# ---------------------------------------------------------------------------
# 2. Environment
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  log "Creating .env from $ENV_EXAMPLE — EDIT IT WITH REAL SECRETS, then re-run."
  cp "$ENV_EXAMPLE" .env
  chmod 600 .env
  die ".env written to $APP_DIR/.env"
fi
[[ -r .env ]] || die ".env is not readable"

# ---------------------------------------------------------------------------
# 3. Pre-flight verification (must stay green before anything ships)
# ---------------------------------------------------------------------------
log "Installing dependencies (npm ci)"
npm ci --no-audit --no-fund

log "Typecheck"
npm run typecheck

log "Unit + integration tests"
npm test

log "Committed-secret scan"
npx tsx scripts/security-scan.ts

# ---------------------------------------------------------------------------
# 4. Build dashboard
#    VITE_API_BASE_URL is empty: the shipped frontend calls the current origin
#    (https://<your-domain>), which is required for a HTTPS deployment.
# ---------------------------------------------------------------------------
log "Building dashboard"
VITE_API_BASE_URL= npm run build --workspace @ads/dashboard

# ---------------------------------------------------------------------------
# 5. Start stack (the control-api container runs Prisma migrate deploy on boot)
# ---------------------------------------------------------------------------
log "Starting production stack"
docker compose \
  -f infrastructure/docker/docker-compose.yml \
  -f infrastructure/docker/docker-compose.prod.yml \
  --env-file .env \
  up --build -d

log "Applying Prisma migrations inside the API container"
docker compose \
  -f infrastructure/docker/docker-compose.yml \
  -f infrastructure/docker/docker-compose.prod.yml \
  exec -T control-api npx prisma migrate deploy --schema apps/control-api/prisma/schema.prisma

# ---------------------------------------------------------------------------
# 6. Health check
# ---------------------------------------------------------------------------
log "Waiting for control-api to become healthy"
api_binding=$(docker compose \
  -f infrastructure/docker/docker-compose.yml \
  -f infrastructure/docker/docker-compose.prod.yml \
  --env-file .env \
  port control-api 4000)
[[ -n "$api_binding" ]] || die "control-api has no published port"
health_url="http://${api_binding}/api/v1/health"
for i in $(seq 1 30); do
  if curl --connect-timeout 2 --max-time 5 -fsS "$health_url" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if curl --connect-timeout 2 --max-time 5 -fsS "$health_url" >/dev/null; then
  log "Health check OK: $health_url"
else
  die "control-api health check failed — inspect: docker compose logs control-api"
fi

log "Deploy complete."
log "Next steps:"
log "  1. Finish Nginx + Certbot TLS termination (docs/production-vps.md)."
log "  2. Register the GitLab webhook: https://<domain>/api/v1/webhooks/gitlab"
log "     (secret = GITLAB_WEBHOOK_SECRET, events: push, merge request, issue)."
log "  3. In the dashboard, enter an API key from API_KEYS (part before :role)."
