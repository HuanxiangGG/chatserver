#!/usr/bin/env bash
# Only GitHub's disposable Compose stack is permitted. Never run against production.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_TEMP:-} == /home/runner/* ]] || { echo 'This acceptance script is CI-only' >&2; exit 1; }
cd "$(dirname "$0")/.."
umask 077
# This tracked template contains placeholders only; real .env is never read.
set -a
source .env.example
set +a
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
export BACKUP_DIR="$RUNNER_TEMP/harbor-private-backup"
export BACKUP_RETENTION_DAYS=0
mkdir -m 700 "$BACKUP_DIR"
docker compose exec -T backend node -e "require('node:fs').writeFileSync('/app/uploads/ci-backup-sentinel.txt','disposable backup fixture',{mode:0o600})"
./scripts/backup.sh
manifest=("$BACKUP_DIR"/manifest-*.sha256)
(cd "$BACKUP_DIR" && sha256sum -c "${manifest[0]##*/}")
dump=("$BACKUP_DIR"/database-*.dump)
archive=("$BACKUP_DIR"/uploads-*.tar.gz)
./scripts/restore.sh "${dump[0]}" harbor_restore_ci
original=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Message"), (SELECT count(*) FROM "GroupAnnouncement"), (SELECT count(*) FROM "Report")'\''')
restored=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d harbor_restore_ci -Atc '\''SELECT (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Message"), (SELECT count(*) FROM "GroupAnnouncement"), (SELECT count(*) FROM "Report")'\''')
[[ "$original" == "$restored" ]] || { echo 'Restored database counts differ' >&2; exit 1; }
python3 scripts/restore-uploads.py "${archive[0]}" "$RUNNER_TEMP/harbor_restore_uploads_ci"
[[ $(cat "$RUNNER_TEMP/harbor_restore_uploads_ci/ci-backup-sentinel.txt") == 'disposable backup fixture' ]] || { echo 'Restored attachment differs' >&2; exit 1; }
# A second restore MUST refuse the existing database and directory.
if ./scripts/restore.sh "${dump[0]}" harbor_restore_ci; then echo 'Unsafe database overwrite accepted' >&2; exit 1; fi
if python3 scripts/restore-uploads.py "${archive[0]}" "$RUNNER_TEMP/harbor_restore_uploads_ci"; then echo 'Unsafe file overwrite accepted' >&2; exit 1; fi
printf 'Real Compose backup and isolated non-overwriting restore acceptance passed.\n'
