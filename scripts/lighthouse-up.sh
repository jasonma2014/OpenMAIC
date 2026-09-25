#!/usr/bin/env bash
# Restart the published image. Called over SSH after `docker load`.
set -euo pipefail

if [ ! -f /opt/mingke/env ]; then
  echo "/opt/mingke/env is missing." >&2
  exit 1
fi
if ! grep -q '^POSTGRES_PASSWORD=.' /opt/mingke/env; then
  echo "/opt/mingke/env must set POSTGRES_PASSWORD." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker is not available for this user." >&2
  exit 1
fi

cd /opt/mingke
docker compose --env-file /opt/mingke/env -f compose.yml up -d --remove-orphans
docker image prune -f >/dev/null
docker compose --env-file /opt/mingke/env -f compose.yml ps
