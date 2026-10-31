#!/usr/bin/env bash
# Called by vps-deploy.sh after the verified stack is healthy (Ubuntu/Debian).
set -Eeuo pipefail
DOMAIN="${1:?domain required}"
API_BINDING="${2:?API binding required}"
DASHBOARD_BINDING="${3:?dashboard binding required}"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || { echo 'Invalid domain' >&2; exit 1; }
for binding in "$API_BINDING" "$DASHBOARD_BINDING"; do
  [[ "$binding" =~ ^127\.0\.0\.1:[0-9]{1,5}$ ]] || { echo 'Expected loopback binding' >&2; exit 1; }
done
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
privileged() { if [[ "$EUID" -eq 0 ]]; then "$@"; else sudo "$@"; fi; }
if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
  privileged apt-get update
  privileged apt-get install -y nginx certbot
fi
privileged nginx -t

# Do not create a duplicate server_name alongside somebody else's site.
privileged nginx -T 2>/dev/null | DOMAIN="$DOMAIN" node -e '
  let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => {
    let file="";
    for (const line of s.split("\n")) {
      const header = line.match(/^# configuration file (.+):$/);
      if (header) file = header[1];
      const names = line.match(/^\s*server_name\s+([^;]+);/);
      if (names && names[1].split(/\s+/).includes(process.env.DOMAIN) &&
          !["/etc/nginx/sites-enabled/autodevsecops", "/etc/nginx/sites-available/autodevsecops"].includes(file)) {
        console.error("Domain already configured in " + file + "; consolidate that site first."); process.exit(1);
      }
    }
  });'

available=/etc/nginx/sites-available/autodevsecops
enabled=/etc/nginx/sites-enabled/autodevsecops
if privileged test -e "$enabled" || privileged test -L "$enabled"; then
  [[ "$(privileged readlink "$enabled")" == "$available" ]] || {
    echo "$enabled must be a symlink to $available; refusing to replace another site" >&2; exit 1;
  }
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
had_config=false
had_link=false
if privileged test -e "$available"; then
  had_config=true
  privileged cp -p "$available" "$work/previous.conf"
fi
if privileged test -L "$enabled"; then had_link=true; fi
rollback() {
  echo 'Nginx setup failed; restoring the previous AutoDevSecOps site.' >&2
  if $had_config; then privileged cp -p "$work/previous.conf" "$available"; else privileged rm -f "$available"; fi
  if ! $had_link; then privileged rm -f "$enabled"; fi
  privileged nginx -t && privileged systemctl reload nginx
}
trap rollback ERR
privileged install -d -m 755 /etc/nginx/sites-available /etc/nginx/sites-enabled /var/www/letsencrypt
install_site() {
  privileged install -m 644 "$1" "${available}.new"
  privileged mv "${available}.new" "$available"
  privileged ln -sfn "$available" "$enabled"
  privileged nginx -t
  privileged systemctl reload nginx
}
cert_dir="/etc/letsencrypt/live/$DOMAIN"
if ! privileged test -f "$cert_dir/fullchain.pem" ||
   ! privileged openssl x509 -in "$cert_dir/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null ||
   ! privileged openssl x509 -in "$cert_dir/fullchain.pem" -noout -checkend 2592000 >/dev/null; then
  # Keep an existing HTTPS site active during renewal; bootstrap only a new site.
  if ! $had_config; then
    sed "s/autodevsecops.spiritedrobot.in/$DOMAIN/g" \
      "$SCRIPT_ROOT/infrastructure/nginx/autodevsecops-bootstrap.conf" > "$work/bootstrap.conf"
    install_site "$work/bootstrap.conf"
  fi
  cert_args=(--non-interactive --agree-tos)
  if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    cert_args+=(--email "$CERTBOT_EMAIL")
  else
    cert_args+=(--register-unsafely-without-email)
  fi
  privileged certbot certonly --webroot -w /var/www/letsencrypt \
    --cert-name "$DOMAIN" -d "$DOMAIN" "${cert_args[@]}"
fi
sed -e "s/DOMAIN_NAME/$DOMAIN/g" \
    -e "s/API_BINDING/$API_BINDING/g" \
    -e "s/DASHBOARD_BINDING/$DASHBOARD_BINDING/g" \
    "$SCRIPT_ROOT/infrastructure/nginx/autodevsecops-compose.conf.template" > "$work/https.conf"
install_site "$work/https.conf"
privileged install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > "$work/reload-nginx.sh" <<'HOOK'
#!/bin/sh
set -e
nginx -t
systemctl reload nginx
HOOK
privileged install -m 755 "$work/reload-nginx.sh" /etc/letsencrypt/renewal-hooks/deploy/autodevsecops-reload-nginx.sh
privileged systemctl enable --now certbot.timer
curl --connect-timeout 5 --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" -fsS "https://$DOMAIN/login" >/dev/null
curl --connect-timeout 5 --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" -fsS "https://$DOMAIN/api/v1/health" >/dev/null
trap - ERR
echo "Nginx and automatic certificate renewal configured for https://$DOMAIN"
