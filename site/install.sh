#!/usr/bin/env bash
# Saga website on a Raspberry Pi (or any Linux with Node 18+ and systemd).
# Run from this folder as your normal user:  bash install.sh
# It installs a system service that keeps the server running (and starts it after a reboot),
# with your files in /opt/saga/data. It doesn't open anything to the internet.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
DATA="${SAGA_DATA:-/opt/saga/data}"
PORT="${SAGA_PORT:-8787}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js isn't installed (see README)"; exit 1; }
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 18 ] || { echo "Node.js 18 or newer is needed (you have $("$NODE" -v))"; exit 1; }
[ -f "$APP/web/index.html" ] || { echo "Can't find the app in $APP/web"; exit 1; }
sudo mkdir -p "$DATA" && sudo chown "$USER" "$DATA" && chmod 700 "$DATA"
sudo tee /etc/systemd/system/saga.service > /dev/null <<UNIT
[Unit]
Description=Saga website
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$HERE
Environment=SAGA_DATA=$DATA
Environment=SAGA_WEB=$APP/web
Environment=SAGA_PORT=$PORT
Environment=SAGA_HOST=127.0.0.1
ExecStart=$NODE $HERE/server.js
Restart=always
RestartSec=3
MemoryMax=600M
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now saga.service
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null; then
  echo "Saga is running on this Pi (port $PORT), files in $DATA."
  echo "Next, put it on your tailnet with HTTPS:"
  echo "  sudo tailscale serve --bg --https=8443 http://127.0.0.1:$PORT"
  echo "then open https://$(tailscale status --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch(e){console.log("<pi-name>.<tailnet>.ts.net")}})'):8443"
else
  echo "The service didn't start. See: journalctl -u saga -n 50"
  exit 1
fi
