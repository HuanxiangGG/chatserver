#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="backups/database-$stamp.dump"
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.partial"
test -s "$file.partial"
mv "$file.partial" "$file"
# The uploads volume is mounted into backend; archive without deleting or moving files.
docker compose exec -T backend tar czf - -C /app/uploads . > "backups/uploads-$stamp.tar.gz.partial"
mv "backups/uploads-$stamp.tar.gz.partial" "backups/uploads-$stamp.tar.gz"
printf 'Created %s and backups/uploads-%s.tar.gz\n' "$file" "$stamp"
