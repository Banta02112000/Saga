#!/usr/bin/env bash
# Saga website: update itself from GitHub every night (04:40), or stop doing that.
#   bash auto-update.sh on     · bash auto-update.sh off     · bash auto-update.sh status
# Your files in /opt/saga/data are never touched by an update. The log: journalctl -u saga-update
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="$(stat -c %U "$APP")"
case "${1:-status}" in
  on)
    sudo tee /etc/systemd/system/saga-update.service > /dev/null <<UNIT
[Unit]
Description=Update the Saga website from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'cd "$APP" && /usr/bin/sudo -u "$OWNER" git pull --ff-only && /bin/systemctl restart saga.service'
UNIT
    sudo tee /etc/systemd/system/saga-update.timer > /dev/null <<UNIT
[Unit]
Description=Update the Saga website every night

[Timer]
OnCalendar=*-*-* 04:40
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable --now saga-update.timer
    echo "Saga will update itself every night around 04:40. Next run: $(systemctl list-timers saga-update.timer --no-legend | awk '{print $1, $2, $3}')"
    ;;
  off)
    sudo systemctl disable --now saga-update.timer 2>/dev/null || true
    echo "Automatic updates are off. Update by hand with: bash $APP/site/update.sh"
    ;;
  status)
    if systemctl is-enabled saga-update.timer > /dev/null 2>&1; then echo "Automatic updates: on"; systemctl list-timers saga-update.timer --no-legend; else echo "Automatic updates: off (turn on: bash $APP/site/auto-update.sh on)"; fi
    ;;
  *) echo "Use: bash auto-update.sh on | off | status"; exit 1 ;;
esac
