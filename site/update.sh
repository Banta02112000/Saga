#!/usr/bin/env bash
# Gets the newest Saga from GitHub and restarts the website. Your files in /opt/saga/data aren't touched.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
sudo systemctl restart saga.service
echo "Updated to: $(git log -1 --format='%h %s')"
