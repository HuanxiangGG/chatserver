#!/usr/bin/env bash
# Restore only into a NEW database; never overwrite an existing database.
set -euo pipefail
cd "$(dirname "$0")/.."
file=${1:?Usage: scripts/restore.sh backups/database-TIMESTAMP.dump new_database_name}
restore_db=${2:?Choose a NEW database name}
[[ "$restore_db" =~ ^harbor_restore_[a-zA-Z0-9_]+$ ]] || { echo 'Database name must begin harbor_restore_'; exit 1; }
test -s "$file"
docker compose exec -T -e RESTORE_DB="$restore_db" postgres sh -c 'createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
docker compose exec -T -e RESTORE_DB="$restore_db" postgres sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$RESTORE_DB"' < "$file"
printf 'Restored into %s. Verify it, then configure POSTGRES_DB and run docker compose up -d backend to recreate it. Original database is preserved.\n' "$restore_db"
