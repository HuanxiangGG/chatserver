#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
backup_dir=${BACKUP_DIR:-backups}
retention=${BACKUP_RETENTION_DAYS:-14}
reserve=${BACKUP_MIN_FREE_MB:-512}
[[ "$retention" =~ ^[0-9]+$ && "$reserve" =~ ^[0-9]+$ ]] || { echo 'Invalid backup limits' >&2; exit 1; }
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd -P)
case "$backup_dir/" in "$PWD/frontend/"*|"$PWD/uploads/"*|"$PWD/nginx/"*|"$PWD/caddy/"*) echo 'Backup directory must not be web-served' >&2; exit 1;; esac
case "$backup_dir" in /|"$PWD"|/var/backups|/home|/root) echo 'Choose a dedicated private backup directory' >&2; exit 1;; esac
[[ $(stat -c %a "$backup_dir") == 700 ]] || { echo 'Backup directory must have permissions 700' >&2; exit 1; }
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
available=$(df -Pk "$backup_dir" | awk 'NR==2 {print $4}')
database_bytes=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database())"')
upload_kib=$(docker compose exec -T backend sh -c 'du -sk /app/uploads' | awk '{print $1}')
[[ "$available" =~ ^[0-9]+$ && "$database_bytes" =~ ^[0-9]+$ && "$upload_kib" =~ ^[0-9]+$ ]] || { echo 'Could not estimate backup space' >&2; exit 1; }
required=$((reserve * 1024 + 2 * (database_bytes / 1024 + upload_kib)))
(( available >= required )) || { echo 'Insufficient space for a complete backup' >&2; exit 1; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
working=$(mktemp -d "$backup_dir/.partial.XXXXXX")
trap 'rm -f "$working/database.dump" "$working/uploads.tar.gz" "$working/manifest"; rmdir "$working" 2>/dev/null || true' EXIT
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$working/database.dump"
test -s "$working/database.dump"
docker compose exec -T postgres pg_restore --list < "$working/database.dump" > /dev/null
docker compose exec -T backend tar czf - -C /app/uploads . > "$working/uploads.tar.gz"
test -s "$working/uploads.tar.gz"
tar tzf "$working/uploads.tar.gz" > /dev/null
mv "$working/database.dump" "$backup_dir/database-$stamp.dump"
mv "$working/uploads.tar.gz" "$backup_dir/uploads-$stamp.tar.gz"
(cd "$backup_dir" && sha256sum "database-$stamp.dump" "uploads-$stamp.tar.gz") > "$working/manifest"
mv "$working/manifest" "$backup_dir/manifest-$stamp.sha256"
# Only completed backup artifacts expire; never touch database or upload volumes.
if (( retention > 0 )); then
 find "$backup_dir" -maxdepth 1 -type f \( -name 'database-*.dump' -o -name 'uploads-*.tar.gz' -o -name 'manifest-*.sha256' \) -mtime "+$retention" -delete
fi
printf 'Backup complete: %s\n' "$backup_dir/manifest-$stamp.sha256"
