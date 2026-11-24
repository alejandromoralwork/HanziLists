#!/usr/bin/env bash
# Build and publish the static site to /srv/hanzi (served by Caddy at /hanzi/).
# One-time setup (needs sudo):  sudo mkdir -p /srv/hanzi && sudo chown "$USER" /srv/hanzi
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${TARGET:-/srv/hanzi}

[ -f public/data/manifest.json ] || npm run data
npm test
npm run build
rsync -a --delete dist/ "$TARGET/"
if systemctl is-enabled hanzilists-api >/dev/null 2>&1; then sudo systemctl restart hanzilists-api; fi
echo "Deployed $(jq -r .version public/data/manifest.json 2>/dev/null || true) to $TARGET"
