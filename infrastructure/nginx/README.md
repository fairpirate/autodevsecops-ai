# VPS Nginx setup

This configuration assumes Ubuntu/Debian, Nginx running directly on the VPS,
and the control API listening on `127.0.0.1:4000` (or a local Docker port mapping).
It serves a built frontend, so a Vite development server on port 5173 is not needed.

| Public URL | Destination |
| --- | --- |
| `https://autodevsecops.spiritedrobot.in/` | Built dashboard files |
| `https://autodevsecops.spiritedrobot.in/api/v1/…` | Control API on port 4000 |

Run commands below from the repository root on your VPS. Replace an existing
Nginx site for this domain rather than enabling two sites with the same
`server_name`. Back up any existing site configuration before replacing it.

## 1. Configure and build the application

Set these values in the server's private root `.env`, preserving your API keys,
Nebius key, credential encryption key and database settings:

```dotenv
CONTROL_API_PORT=4000
CONTROL_API_BASE_URL=http://127.0.0.1:4000
PUBLIC_BASE_URL=https://autodevsecops.spiritedrobot.in
VITE_API_BASE_URL=
AI_PROVIDER=nebius
QUEUE_DRIVER=memory
```

An empty `VITE_API_BASE_URL` makes the browser use the current HTTPS origin.
Do not set it to `localhost:4000` on a deployed frontend: that would contact the
visitor's machine. It is a build-time variable; rebuild after changing it.
Do not put `/api/v1` in that variable; the client appends that path itself.

```bash
npm ci
npm run typecheck
VITE_API_BASE_URL= npm run build --workspace @ads/dashboard
sudo install -d -m 755 /var/www/autodevsecops-ai/dashboard
sudo cp -R apps/dashboard/dist/. /var/www/autodevsecops-ai/dashboard/
sudo chmod -R a+rX /var/www/autodevsecops-ai/dashboard
```

The empty inline variable also overrides any old value in `.env` during the build.
Only copy `dist/` into the web root; keep the repository and `.env` outside it.

Keep the API running under your existing service manager. Its compiled entrypoint
from the repository root is:

```bash
node --env-file=.env apps/control-api/dist/server.js
```

Before configuring the proxy, confirm the backend works:

```bash
curl -i http://127.0.0.1:4000/api/v1/health
```

Expect HTTP 200 and JSON. This Nginx setup does not install or supervise the API,
provision databases, or change the application's execution/persistence limitations.
The default memory store loses data on API restarts; see the main README.

## 2. Obtain a certificate if needed

Point the domain's DNS A record (and AAAA record if used) at this VPS. Ports 80
and 443 must reach Nginx. If you already have a valid certificate at the paths
in `autodevsecops.conf`, skip this step. For other certificate locations, edit
`ssl_certificate` and `ssl_certificate_key` in that file.

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot
sudo install -d -m 755 /var/www/letsencrypt
sudo cp infrastructure/nginx/autodevsecops-bootstrap.conf /etc/nginx/sites-available/autodevsecops
sudo ln -sfn /etc/nginx/sites-available/autodevsecops /etc/nginx/sites-enabled/autodevsecops
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt --cert-name autodevsecops.spiritedrobot.in -d autodevsecops.spiritedrobot.in
```

Certbot prompts for registration details. The temporary configuration serves
HTTP validation without requiring certificate files that do not yet exist.

## 3. Install the HTTPS configuration

```bash
sudo cp infrastructure/nginx/autodevsecops.conf /etc/nginx/sites-available/autodevsecops
sudo ln -sfn /etc/nginx/sites-available/autodevsecops /etc/nginx/sites-enabled/autodevsecops
sudo nginx -t && sudo systemctl reload nginx
```

Set a renewal deploy hook so Nginx loads renewed certificates:

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

## 4. Verify routing

```bash
curl -I https://autodevsecops.spiritedrobot.in/
curl -i https://autodevsecops.spiritedrobot.in/api/v1/health
curl -i https://autodevsecops.spiritedrobot.in/api/v1/projects
```

The first URL serves HTML. Health must return HTTP 200 and JSON.
Projects without authentication should return HTTP 401 and JSON.
If the backend is stopped, API requests return HTTP 503 and a JSON error,
not the dashboard's `index.html`. In the dashboard, enter a control API key
from `API_KEYS` (the key portion before `:admin`/`:engineer`/`:viewer`).

The `/api/` location preserves the API path and disables response buffering
for SSE. See the [Nginx proxy module documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
and [Certbot webroot guide](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

These files have not been installed on your VPS. Run `nginx -t` there before
reloading; certificate paths, installed Nginx capabilities and other enabled
sites must be checked on that host.
