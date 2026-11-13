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
