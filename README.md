# Server Creator

Open any website **through your own server**, so the website sees the server's location instead of yours.

Example: you are in **Pakistan 🇵🇰**, you run Server Creator on a server in the **UAE 🇦🇪**, and every site you open through it thinks you are browsing from the UAE.

```
You (Pakistan)  ──►  Server Creator (UAE server)  ──►  UAE website
                     the website sees a UAE IP
```

## Important: the location comes from where the server runs

The code cannot change its own country. It uses the IP address of the machine it runs on. To appear in the UAE, run it on a UAE server, or point it at a UAE proxy.

| Option | How |
|---|---|
| **UAE cloud server** (recommended) | Rent a small VM in a UAE region, e.g. AWS `me-central-1` (UAE), Azure *UAE North* (Dubai), Oracle Cloud *UAE East (Dubai)*, or a local VPS provider. Run Server Creator on it. |
| **Upstream proxy** | Run Server Creator anywhere and set `UPSTREAM_PROXY=http://user:pass@your-uae-proxy:port`. All traffic then leaves through that proxy. |

The homepage shows the country websites will see (flag, city and IP), so you can confirm it's working.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
PROXY_PASSWORD=choose-a-password npm start
# open http://localhost:3000
```

Or with Docker:

```bash
docker build -t server-creator .
docker run -d -p 80:3000 -e PROXY_PASSWORD=choose-a-password server-creator
```

### One-command deploy on a UAE server (Ubuntu)

1. Create an Ubuntu VM in a UAE region (AWS `me-central-1`, Azure *UAE North*, Oracle Cloud *UAE East (Dubai)*), and allow ports 80 and 443 in its firewall or security group.
2. SSH in and run:

```bash
curl -fsSL https://raw.githubusercontent.com/zzohranzebnvdmgpnty-cpu/Create-A-Server/main/deploy.sh | sudo PROXY_PASSWORD=choose-a-password bash
```

3. Open the address it prints (`http://<server-ip>`) from your phone or PC in Pakistan.

The script installs Node.js and runs Server Creator as a service that restarts automatically. Add `DOMAIN=proxy.yourdomain.com` before `bash` to get automatic HTTPS (point the domain's DNS at the server first). Run it again later to update.

## Telegram bot

Control your server from Telegram. Send it a website and it opens it **from the server's location**, replies with the page title, a text preview, the status code, and a button to open it through your server.

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. Start the server with the token:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC... PUBLIC_URL=https://proxy.yourdomain.com PROXY_PASSWORD=choose-a-password npm start
```

3. Send `/id` to your bot, then restart with `TELEGRAM_ALLOWED_USERS=<your id>` so only you can use it.

With the deploy script, add the variables before `bash`:

```bash
curl -fsSL https://raw.githubusercontent.com/zzohranzebnvdmgpnty-cpu/Create-A-Server/main/deploy.sh | sudo PROXY_PASSWORD=choose-a-password TELEGRAM_BOT_TOKEN=123456:ABC... TELEGRAM_ALLOWED_USERS=11111111 bash
```

| Command | What it does |
|---|---|
| any text, or `/open gulfnews.com` | Opens the site from the server, shows title + preview + "Open through server" button |
| `/location` | Country, city and IP that websites see |
| `/check gulfnews.com` | Status code and response time only |
| `/status` | Server uptime |
| `/id` | Your Telegram user id |

The bot uses long polling, so it needs no webhook, domain or extra open port.

## Settings (environment variables)

| Variable | Meaning |
|---|---|
| `PORT` | Port to listen on (default `3000`). |
| `PROXY_PASSWORD` | Asks for a password before anyone can use the server. **Set this on any public server** so strangers can't use your bandwidth. Any username works. |
| `UPSTREAM_PROXY` | Send all outgoing traffic through another HTTP proxy, e.g. one located in the UAE. |
| `TELEGRAM_BOT_TOKEN` | Turns on the Telegram bot (token from @BotFather). |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated Telegram user ids allowed to use the bot. If empty, anyone can use it. |
| `PUBLIC_URL` | Public address of the server (e.g. `https://proxy.yourdomain.com`), used for the bot's tap-to-open links. Set automatically by `deploy.sh`. |
| `ALLOW_PRIVATE_HOSTS` | `1` allows opening localhost and private network addresses. For local testing only. |

## How it works

- `/go?url=gulfnews.com` → redirects to `/p/https://gulfnews.com/`
- `/p/<url>`: the server fetches the page and rewrites links, images, scripts, forms, CSS, redirects and cookies so they keep going through the server. It also adds a small floating address bar.
- A small script injected into each page routes `fetch`, `XMLHttpRequest` and `window.open` calls through the server.
- `/api/location` shows which IP and country websites see.
- Requests to private or internal network addresses are blocked.

## Limitations

- Very complex web apps (some video players, sites using Service Workers or WebSockets, and Google or Facebook logins) may not fully work through a rewriting proxy. For those, a VPN or SOCKS proxy on the same UAE server works better.
- Respect the terms of service and local laws for the websites you access.
