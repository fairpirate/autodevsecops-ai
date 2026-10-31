#!/usr/bin/env bash
#
# vps-deploy.sh — deploy AutoDevSecOps AI to a production VPS (Docker Compose mode).
#
# Review before running. Designed to be idempotent: safe to re-run after changes.
# Prerequisites on the VPS: Docker + Compose plugin, git, curl, a non-root user
# able to run docker (sudo usermod -aG docker $USER), and Nginx + Certbot for TLS.
#
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_ROOT}"
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

# Dedicated defaults override old .env ports that may belong to another project.
# Explicit shell overrides remain available for hosts with different port usage.
export CONTROL_API_HOST_PORT="${CONTROL_API_HOST_PORT:-14000}"
export DASHBOARD_HOST_PORT="${DASHBOARD_HOST_PORT:-18080}"
export VITE_API_BASE_URL=""
PUBLIC_BASE_URL=$(node --env-file=.env -e '
  const u = new URL(process.env.PUBLIC_BASE_URL || "https://autodevsecops.spiritedrobot.in");
  if (u.protocol !== "https:" || u.port || u.username || u.password ||
      u.pathname !== "/" || u.search || u.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname)) {
    console.error("PUBLIC_BASE_URL must be an HTTPS domain without a port or path"); process.exit(1);
  }
  console.log(u.origin);
')
export PUBLIC_BASE_URL
DOMAIN="${PUBLIC_BASE_URL#https://}"
for port in "$CONTROL_API_HOST_PORT" "$DASHBOARD_HOST_PORT"; do
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port > 1024 && 10#$port < 65536 )) || die "Invalid host port: $port"
done
[[ "$CONTROL_API_HOST_PORT" != "$DASHBOARD_HOST_PORT" ]] || die "API and dashboard ports must differ"

# Use the same resolved Compose inputs for validation, startup and inspection.
compose() {
  docker compose \
    -f infrastructure/docker/docker-compose.yml \
    -f infrastructure/docker/docker-compose.prod.yml \
    --env-file .env "$@"
}
log "Checking production bindings: API 127.0.0.1:$CONTROL_API_HOST_PORT; dashboard 127.0.0.1:$DASHBOARD_HOST_PORT"
compose config --format json | node scripts/vps-check-compose.mjs

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
compose up --build -d

log "Applying Prisma migrations inside the API container"
compose exec -T control-api npx prisma migrate deploy --schema apps/control-api/prisma/schema.prisma

# ---------------------------------------------------------------------------
# 6. Health check
# ---------------------------------------------------------------------------
log "Waiting for control-api to become healthy"
api_binding=$(compose port control-api 4000)
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

log "Verifying authenticated project storage"
# Read the key inside the container; never put credentials in command arguments
# or output. SELECT 1 alone cannot prove the application tables exist.
compose exec -T control-api node -e '
  const key = (process.env.API_KEYS || "").split(",")[0].split(":")[0];
  if (!key) { console.error("Project storage check: API_KEYS is missing"); process.exit(1); }
  fetch("http://127.0.0.1:4000/api/v1/projects", {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000),
  }).then(async r => {
    if (!r.ok || !Array.isArray((await r.json()).items)) throw new Error();
  }).catch(() => { console.error("Project storage check failed; inspect API logs and Prisma migrations"); process.exit(1); });
'

dashboard_binding=$(compose port dashboard 80)
[[ "$api_binding" =~ ^127\.0\.0\.1:[0-9]+$ && "$dashboard_binding" =~ ^127\.0\.0\.1:[0-9]+$ ]] || die "Expected loopback-only published ports"
curl --connect-timeout 2 --max-time 10 -fsS "http://${dashboard_binding}/login" >/dev/null || die "Dashboard /login is not ready"

log "Configuring Nginx and TLS for $DOMAIN"
bash scripts/vps-configure-nginx.sh "$DOMAIN" "$api_binding" "$dashboard_binding"
log "Verifying public HTTPS routing"
curl --connect-timeout 10 --max-time 20 -fsS "$PUBLIC_BASE_URL/login" >/dev/null
curl --connect-timeout 10 --max-time 20 -fsS "$PUBLIC_BASE_URL/api/v1/health" >/dev/null

log "Deploy complete: $PUBLIC_BASE_URL/login"
log "Next steps:"
log "  1. Register the GitLab webhook: $PUBLIC_BASE_URL/api/v1/webhooks/gitlab"
log "     (secret = GITLAB_WEBHOOK_SECRET, events: push, merge request, issue)."
log "  2. In the dashboard, enter an API key from API_KEYS (part before :role)."
