# Saga website

The Saga app in a browser, served from your own machine (for example a Raspberry Pi) and reachable only on your
Tailscale network. It's a separate copy: bring your data over with the app's backup file (Settings › Backup).

## What it needs
- Linux with systemd, Node.js 18 or newer, git, and Tailscale signed in to your tailnet.
- In the Tailscale admin console: MagicDNS and HTTPS certificates switched on (DNS page).

## Install
```
sudo mkdir -p /opt/saga && sudo chown $USER /opt/saga
git clone https://github.com/Banta02112000/Saga /opt/saga/app
bash /opt/saga/app/site/install.sh
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8787
```
Open `https://<machine>.<tailnet>.ts.net:8443` on any device signed in to your tailnet.

## Signing in, and more than one person
Each person has a name, a password, a **sync key** for their phone app and their own files (the first account,
the owner, keeps the files in `/opt/saga/data`; everyone else's are in `/opt/saga/data/users/<name>/`).
Run these on the Pi (`cd /opt/saga/app/site` first, and put `SAGA_DATA=/opt/saga/data` in front of each):
- `node server.js --set-password banta` — set or change a password (asks for it), prints that person's sync key
- `node server.js --add-user marco` — a new account for a friend (asks for a password, prints their sync key)
- `node server.js --users` — who has an account · `node server.js --remove-user marco` — remove one (files stay)
- `node server.js --tailscale marco marco@gmail.com` — that Tailscale login opens Marco's Saga without a password
Through Tailscale (port 8787) people on your tailnet are let in without the password (as the owner, unless linked
with `--tailscale`); set `SAGA_TRUST_TAILSCALE=0` in the service to ask everyone. The public entrance (port 8788)
always asks: name and password in a browser (30 days signed in, 5 wrong tries per 15 minutes per address), the
sync key in the phone app. A password change is picked up without restarting.

## From anywhere, without Tailscale (optional)
Point a tunnel or a reverse proxy at `http://127.0.0.1:8788` (never at 8787). With Cloudflare Tunnel:
```
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login
cloudflared tunnel create saga
cloudflared tunnel route dns saga saga.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8788 saga
```
(`sudo cloudflared service install` keeps it running.) With Caddy instead: `saga.yourdomain.com { reverse_proxy 127.0.0.1:8788 }`.

## Phone ↔ website
In the phone app: Settings › Accounts and sync › Saga website: the address and the sync key. The phone then sends
what changed after each sync, when you open it, and shortly after changes; the server merges entry by entry
(site/merge.js; where both sides changed the same thing, the phone's wins) and open website pages reload.

## Update
`bash /opt/saga/app/site/update.sh`

## Where things are
- Your files: `/opt/saga/data` (a copy of each file as it was at the start of each day, for a week: `/opt/saga/data/.daily`).
- Logs: `journalctl -u saga -n 100`
- Stop or start: `sudo systemctl stop saga` / `sudo systemctl start saga`

## Differences from the phone app
- No hidden IMDb browser: IMDb is read through IMDb's data service only.
- No widgets, notifications or background sync: syncs run while the page is open.
- Keys you type are kept in `/opt/saga/data/secrets.json` on your machine (the phone keeps them in its keystore).
