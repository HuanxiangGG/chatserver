#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -z "$(git status --porcelain)" || { echo 'Working tree has changes; review before updating.'; exit 1; }
./scripts/backup.sh
git pull --ff-only
docker compose up -d --build
docker compose exec -T backend npx prisma migrate deploy
docker compose ps
