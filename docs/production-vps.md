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

## 6. Nginx + Certbot (TLS termination)

Host Nginx proxies `/api/` to the API container and everything else to the
dashboard container. Adapt `infrastructure/nginx/autodevsecops.conf`:

On a shared VPS, set unused host ports in `.env`, for example
`CONTROL_API_HOST_PORT=14000` and `DASHBOARD_HOST_PORT=18080`. Keep
`CONTROL_API_PORT=4000` for the API inside Docker. In this project's Nginx
site, use `proxy_pass http://127.0.0.1:14000;` for `/api/` and
`proxy_pass http://127.0.0.1:18080;` for `/`. Adjust manual health checks to
`http://127.0.0.1:14000/api/v1/health`. The deploy script discovers the
published API port automatically. Existing projects can keep their ports.

1. Replace `server_name autodevsecops.spiritedrobot.in` with your domain.
2. Replace cert paths `/etc/letsencrypt/live/<domain>/...` after Certbot runs.
3. For Compose mode, change `root /var/www/...` in the `location /` block to
   `proxy_pass http://127.0.0.1:8080;` (dashboard container), keeping the
   `/api/` proxy to `http://127.0.0.1:4000` with the SSE settings
   (`proxy_buffering off`, `proxy_read_timeout 3600s`).

Bootstrap for the first certificate:

```bash
sudo apt-get install -y nginx certbot
sudo install -d -m 755 /var/www/letsencrypt
sudo cp infrastructure/nginx/autodevsecops-bootstrap.conf /etc/nginx/sites-available/autodevsecops
# edit server_name in that file to your domain
sudo ln -sfn /etc/nginx/sites-available/autodevsecops /etc/nginx/sites-enabled/autodevsecops
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name platform.example.com -d platform.example.com
```

Then install the real config:

```bash
sudo cp infrastructure/nginx/autodevsecops.conf /etc/nginx/sites-available/autodevsecops
# edit server_name + cert paths to your domain
sudo ln -sfn /etc/nginx/sites-available/autodevsecops /etc/nginx/sites-enabled/autodevsecops
sudo nginx -t && sudo systemctl reload nginx
```

Renewal hook (reload Nginx on renewed certs):

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'HOOK'
#!/bin/sh
nginx -t && systemctl reload nginx
HOOK
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

Verify:

```bash
curl -I https://platform.example.com/               # HTML, redirect from :80
curl -i https://platform.example.com/api/v1/health  # HTTP 200 JSON
curl -i https://platform.example.com/api/v1/projects # HTTP 401 JSON (no key yet)
```

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
