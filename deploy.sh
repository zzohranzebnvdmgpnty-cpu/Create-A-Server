#!/usr/bin/env bash
# One-command installer for Server Creator on a fresh Ubuntu/Debian server.
# Usage (run on the server):
#   curl -fsSL https://raw.githubusercontent.com/zzohranzebnvdmgpnty-cpu/Create-A-Server/main/deploy.sh | sudo PROXY_PASSWORD=yourpassword bash
# Optional: DOMAIN=proxy.example.com  -> automatic HTTPS via Caddy (point the domain's DNS to this server first)
# Optional: TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_ALLOWED_USERS=11111111  -> enable the Telegram bot
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Please run as root (use sudo)."; exit 1; fi
if [ -z "${PROXY_PASSWORD:-}" ]; then
  read -rp "Choose a password for your Server Creator: " PROXY_PASSWORD </dev/tty
fi

echo ">> Installing Node.js and git..."
apt-get update -y
apt-get install -y ca-certificates curl git
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo ">> Downloading Server Creator..."
if [ -d /opt/server-creator/.git ]; then
  git -C /opt/server-creator pull --ff-only
else
  git clone https://github.com/zzohranzebnvdmgpnty-cpu/Create-A-Server.git /opt/server-creator
fi
cd /opt/server-creator
npm install --omit=dev

PORT=80
[ -n "${DOMAIN:-}" ] && PORT=3000

if [ -n "${DOMAIN:-}" ]; then
  URL="https://$DOMAIN"
else
  URL="http://$(curl -fsS https://api.ipify.org || echo YOUR-SERVER-IP)"
fi

echo ">> Creating background service..."
cat > /etc/systemd/system/server-creator.service <<EOF
[Unit]
Description=Server Creator
After=network-online.target

[Service]
WorkingDirectory=/opt/server-creator
ExecStart=$(command -v node) server.js
Environment=PORT=$PORT
Environment=PROXY_PASSWORD=$PROXY_PASSWORD
Environment=UPSTREAM_PROXY=${UPSTREAM_PROXY:-}
Environment=TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
Environment=TELEGRAM_ALLOWED_USERS=${TELEGRAM_ALLOWED_USERS:-}
Environment=PUBLIC_URL=${PUBLIC_URL:-$URL}
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now server-creator
systemctl restart server-creator

if [ -n "${DOMAIN:-}" ]; then
  echo ">> Setting up HTTPS for $DOMAIN..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
  echo "$DOMAIN {
  reverse_proxy localhost:3000
}" > /etc/caddy/Caddyfile
  systemctl restart caddy
fi

# Open the firewall if ufw is active
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80; ufw allow 443; fi

echo
echo "=============================================="
echo " Server Creator is running!"
echo " Open: $URL"
echo " Password: $PROXY_PASSWORD (any username)"
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo " Telegram bot: enabled (send /start to your bot)"
echo " Also allow ports 80/443 in your cloud firewall / security group."
echo "=============================================="
