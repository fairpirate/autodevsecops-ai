# Production VPS deployment — AutoDevSecOps AI

This guide runs AutoDevSecOps AI on a single Linux VPS for production:
Docker Compose for the API, Postgres, Redis and dashboard, with host Nginx
terminating TLS (Certbot/Let's Encrypt).

> Honest scope note (see README "Limitations"): this deploys the platform
> itself. Review/repair/verification of customer repositories still depends on
> the target repo having runtimes/dependencies provisioned, and the Nebius
> path requires `QUEUE_DRIVER=memory`.

## Architecture on the VPS

```
 internet
    |
  [DNS: A record -> VPS IP]      ports 80/443 only (UFW)
    |
[host Nginx] TLS termination -> 127.0.0.1:4000 control API
                              -> 127.0.0.1:8080 dashboard container
                              -> /var/www/letsencrypt (certbot)
[docker compose]
  - postgres:16   (Docker network only, no host port)
  - redis:7       (Docker network only, no host port)
  - control-api   (migrate + server; health-checked)
  - dashboard     (built Vite app, served by nginx)
  - [workers]     (optional --profile workers)
```

## 1. VPS prerequisites

Ubuntu 22.04/24.04 (Debian works too). Suggested minimum: 2 vCPU, 4 GB RAM,
40 GB disk; 8 GB RAM if you run the worker services.

```bash
# as root on a fresh VPS
apt-get update && apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg lsb-release ufw fail2ban git

# a non-root deploy user
adduser --disabled-password --gecos "" autodevsecops
usermod -aG sudo autodevsecops
```

SSH: key-based only, disable password root login, keep port 22 in UFW.

## 2. DNS

Create an A record (and AAAA if you have IPv6) for your domain, e.g.
`platform.example.com`, pointing at the VPS public IP. Ports 80 and 443 must
reach the VPS.

## 3. Install Docker + Compose

```bash
# as the deploy user (or root)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in (or newgrp docker) so the docker group applies
docker compose version   # requires >=2.24.4 for !override port replacement
```

## 4. Clone the repository and configure production environment

```bash
git clone https://github.com/fairpirate/autodevsecops-ai.git ~/autodevsecops-ai
cd ~/autodevsecops-ai
cp infrastructure/env/production.env.example .env
chmod 600 .env
```

Edit `.env` (every `CHANGE_ME`):

| Variable | Production value |
|---|---|
| `PUBLIC_BASE_URL` | `https://platform.example.com` (reachable by GitLab webhooks) |
| `API_KEYS` | `openssl rand -hex 32` per dashboard key, e.g. `abcd1234:admin` |
| `STORE` | `prisma` |
| `POSTGRES_PASSWORD` | strong unique password |
| `GITLAB_WEBHOOK_SECRET` | strong unique secret (entered in GitLab webhook settings) |
| `CREDENTIAL_KEY_BASE64` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AI_PROVIDER` | `deterministic` (or `nebius` — then `QUEUE_DRIVER=memory` is required) |

Never commit `.env` — it is gitignored.

## 5. Build, migrate, launch

```bash
cd ~/autodevsecops-ai
npm ci --no-audit --no-fund
npm run typecheck
npm test
npx tsx scripts/security-scan.ts

VITE_API_BASE_URL= npm run build --workspace @ads/dashboard

docker compose \
  -f infrastructure/docker/docker-compose.yml \
  -f infrastructure/docker/docker-compose.prod.yml \
  --env-file .env \
  up --build -d

docker compose \
  -f infrastructure/docker/docker-compose.yml \
  -f infrastructure/docker/docker-compose.prod.yml \
  exec -T control-api npx prisma migrate deploy \
  --schema apps/control-api/prisma/schema.prisma

curl -i http://127.0.0.1:4000/api/v1/health   # expect HTTP 200 JSON
```

There is also `scripts/vps-deploy.sh`, which performs steps 3–5 end-to-end
(review it before running).

If the API restarts during migrations with Prisma OpenSSL warnings, rebuild
the API image after updating `infrastructure/docker/control-api.Dockerfile`.
The image installs OpenSSL in both build and runtime stages and explicitly
generates Prisma Client for the container platform. Installing OpenSSL only
on the VPS host does not install it inside the container. Keep any extra
port override file in the Compose command when rebuilding on a shared VPS.

### Database schema on first deployment

The repository now includes `20261031000000_initial`, which creates the
application tables. Earlier versions had no migrations, so `migrate deploy`
could finish without creating `Project` even though `/health` returned 200
from `SELECT 1`. Rebuild the API image and rerun the deploy script to include
and apply the migration. The script now checks authenticated project listing
before continuing to configure HTTPS.

If this database was already initialized through `prisma db push` or another
migration history, compare its schema and baseline it with Prisma Migrate
before applying the initial migration. Do not reset an existing database to
resolve migration history conflicts.

## 6. Automatic Nginx + Certbot setup

Run `./scripts/vps-deploy.sh` from your checkout. After verification and local
health checks, it installs Nginx/Certbot if missing, enables a dedicated
`autodevsecops` site, obtains the domain certificate using HTTP webroot
validation, installs HTTPS proxies, enables the renewal timer and deploy hook,
and checks `/login` and `/api/v1/health` over HTTPS. Re-running reuses a valid
certificate. Failed configuration checks restore the previous site.

Set `PUBLIC_BASE_URL` in `.env` to your HTTPS domain (default:
`https://autodevsecops.spiritedrobot.in`). DNS must point to this VPS and ports
80/443 must be reachable. The script needs root or sudo for host configuration;
other projects' Nginx sites are preserved. A duplicate exact domain in another
site causes a diagnostic failure rather than silently enabling conflicting sites.

The script uses dedicated loopback ports 14000 (API) and 18080 (dashboard),
overriding old `.env` port values that may point at socialmedia services.
For different ports, supply shell overrides on every deployment:

```bash
CONTROL_API_HOST_PORT=14001 DASHBOARD_HOST_PORT=18081 ./scripts/vps-deploy.sh
```

It renders proxy targets from the actual Docker bindings. Port conflicts stop
deployment; the script does not stop unrelated containers. Before startup it
checks the resolved Compose model against the selected ports and rejects extra
bindings, public bindings and published database ports.

If an older deployment still tries to bind port 4000, run:

```bash
CONTROL_API_HOST_PORT=14000 DASHBOARD_HOST_PORT=18080 ./scripts/vps-deploy.sh
```

Ensure the updated script, helper files and production overlay are present on
the VPS. Changes made in another checkout are not automatically uploaded. The Compose overlay
also defaults to 14000/18080 when used directly. The dashboard build uses the
current browser origin, and its Nginx container handles React routes like `/login`.

Optionally provide `CERTBOT_EMAIL=you@example.com` when invoking the script.
Without it, Certbot registers without an email. Existing certificates with over
30 days remaining are reused. Certificate issuance requires working public DNS
and HTTP validation; it cannot repair DNS or firewall configuration automatically.
The installer targets Ubuntu/Debian with host Nginx and systemd.

For a non-Docker deployment with a static frontend, use
[infrastructure/nginx/README.md](../infrastructure/nginx/README.md).

## 7. Firewall

```bash
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Postgres (5432) and Redis (6379) are reachable only inside the Compose network;
production publishes neither port on the host. This avoids conflicts with
other projects' database and Redis services. The API still connects to
`postgres:5432` and `redis:6379`. Fail2Ban protects SSH by default.

## 8. GitLab integration

In GitLab (project Settings > Webhooks):

- URL: `https://platform.example.com/api/v1/webhooks/gitlab`
- Secret token: the value of `GITLAB_WEBHOOK_SECRET`
- Events: Push events, Merge request events, Issue events
- Enable SSL verification

For GitLab Duo flows, enable "Send Duo flow events to this webhook" on the
project webhook and set `GITLAB_FLOW_CALLBACK_HOOK_ID` to that webhook's ID.
Only the documented Duo endpoints are used
(`POST /api/v4/ai/duo_workflows/workflows`, `callback_hook_id`,
`client_reference`, `event_id` dedupe).

In the dashboard, enter a key from `API_KEYS` (the part before `:role`) as the
Dashboard API key, then connect a GitLab project with its project ID and a
project/group access token.

## 9. Backups

Postgres data lives in the `pgdata` named volume. Daily dump:

```bash
# /etc/cron.d/autodevsecops-backup (root cron)
0 3 * * * root docker compose \
  -f /opt/autodevsecops-ai/infrastructure/docker/docker-compose.yml \
  -f /opt/autodevsecops-ai/infrastructure/docker/docker-compose.prod.yml \
  exec -T postgres pg_dumpall -U ads \
  | gzip > /opt/autodevsecops-ai/infra-data/backup-$(date +\%F).sql.gz
```

Restore: `gunzip < file.sql.gz | docker compose exec -T postgres psql -U ads -d autodevsecops`.
`infra-data/` is gitignored — keep backups off-server as well.

## 10. Updates and rollback

```bash
cd ~/autodevsecops-ai
git pull --ff-only
npm ci --no-audit --no-fund
npm run typecheck
npm test
npx tsx scripts/security-scan.ts
VITE_API_BASE_URL= npm run build --workspace @ads/dashboard
docker compose ... up --build -d
docker compose ... exec -T control-api npx prisma migrate deploy --schema apps/control-api/prisma/schema.prisma
```

Rollback: redeploy the previous image/commit (`docker compose up --build`
after `git checkout <previous>`), or promote the previous known-good artifact
digest as described in `infrastructure/deployment/promotion.yml`
(DEVELOPMENT → STAGING → PRODUCTION with the same immutable digest).

## 11. Operations checklist

- [ ] `.env` exists, `chmod 600`, not committed
- [ ] `API_KEYS` rotated from defaults; dashboard login works
- [ ] `GITLAB_WEBHOOK_SECRET` matches GitLab; webhook ping returns 200
- [ ] `PUBLIC_BASE_URL` is the public HTTPS URL
- [ ] `STORE=prisma` (data survives restarts)
- [ ] Nginx + Certbot: health endpoints return JSON over HTTPS
- [ ] UFW: only 22/80/443; Postgres/Redis not public
- [ ] `docker compose logs control-api` inspected after first start
- [ ] Backup cron running; test restore performed
- [ ] `npx tsx scripts/security-scan.ts` passes on the deployed tree

## 12. Alternative: systemd (no Docker for the API)

If you prefer running the API directly under systemd (per
`infrastructure/nginx/README.md`), see
`infrastructure/systemd/ads-api.service`. Build the API once
(`npm run build`), place the unit at `/etc/systemd/system/ads-api.service`,
then `systemctl enable --now ads-api`. Nginx still proxies to `127.0.0.1:4000`.
