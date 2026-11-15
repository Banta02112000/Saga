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

## Signing in
The installer sets a password and prints it, with a **sync key** for the phone app. Change them any time:
`SAGA_DATA=/opt/saga/data node /opt/saga/app/site/server.js --set-password`
- Through Tailscale (port 8787, behind `tailscale serve`) people on your tailnet are let in without the password.
  Set `SAGA_TRUST_TAILSCALE=0` in the service to ask for it there too.
- The public entrance (port 8788) always asks for the password (browsers) or the sync key (the phone app),
  allows 5 wrong passwords per 15 minutes per address, and keeps you signed in for 30 days.

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
