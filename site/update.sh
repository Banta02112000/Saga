#!/usr/bin/env bash
# Gets the newest Saga from GitHub and restarts the website. Your files in /opt/saga/data aren't touched.
# Since 0.7.0 it also turns on updates every 6 hours, unless you turned them off (bash auto-update.sh off).
set -euo pipefail
main() {
  cd "$(dirname "$0")/.."
  git pull --ff-only
  sudo systemctl restart saga.service
  echo "Updated to: $(git log -1 --format='%h %s')"
  if [ ! -f .no-auto-update ] && ! systemctl is-enabled saga-update.timer > /dev/null 2>&1; then
    bash site/auto-update.sh on || echo "(automatic updates not turned on: bash site/auto-update.sh on)"
  fi
}
main "$@"
