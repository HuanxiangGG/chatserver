#!/usr/bin/env bash
# Only GitHub's disposable Compose stack is permitted. Never run against production.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_TEMP:-} == /home/runner/* ]] || { echo 'This acceptance script is CI-only' >&2; exit 1; }
cd "$(dirname "$0")/.."
# API fixtures and Docker operations are restricted to this hosted runner.
export BACKUP_CI_URL=http://127.0.0.1:8080
[[ -z ${DOCKER_HOST:-} && ${DOCKER_CONTEXT:-default} == default ]] || { echo 'Remote Docker targets are forbidden' >&2; exit 1; }
case $(docker context inspect --format '{{.Endpoints.docker.Host}}') in
  unix:///var/run/docker.sock|unix:///run/docker.sock) ;;
  *) echo 'A local CI Docker socket is required' >&2; exit 1 ;;
esac
umask 077
# This tracked template contains placeholders only; real .env is never read.
set -a
source .env.example
set +a
export COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
export BACKUP_DIR="$RUNNER_TEMP/harbor-private-backup"
export BACKUP_RETENTION_DAYS=0
mkdir -m 700 "$BACKUP_DIR"
node scripts/backup-fixture-ci.mjs seed > "$BACKUP_DIR/fixture.json"
node scripts/backup-fixture-ci.mjs sql "$BACKUP_DIR/fixture.json" > "$BACKUP_DIR/verify.sql"
docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' < "$BACKUP_DIR/verify.sql" > "$BACKUP_DIR/original-counts.txt"
node scripts/backup-fixture-ci.mjs assert-counts "$BACKUP_DIR/original-counts.txt"
docker compose exec -T backend node -e "require('node:fs').writeFileSync('/app/uploads/ci-backup-sentinel.txt','disposable backup fixture',{mode:0o600})"
./scripts/backup.sh
manifest=("$BACKUP_DIR"/manifest-*.sha256)
(cd "$BACKUP_DIR" && sha256sum -c "${manifest[0]##*/}")
dump=("$BACKUP_DIR"/database-*.dump)
archive=("$BACKUP_DIR"/uploads-*.tar.gz)
./scripts/restore.sh "${dump[0]}" harbor_restore_ci
docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d harbor_restore_ci -At' < "$BACKUP_DIR/verify.sql" > "$BACKUP_DIR/restored-counts.txt"
node scripts/backup-fixture-ci.mjs assert-counts "$BACKUP_DIR/restored-counts.txt"
# Counts cover legacy + incremental tables; fixture digests cover IDs, permissions,
# assignment/state, message/reply history, attachment metadata and Bot authorizations.
cmp "$BACKUP_DIR/original-counts.txt" "$BACKUP_DIR/restored-counts.txt" || { echo 'Restored database counts or fixture history differ' >&2; exit 1; }
python3 scripts/restore-uploads.py "${archive[0]}" "$RUNNER_TEMP/harbor_restore_uploads_ci"
[[ $(cat "$RUNNER_TEMP/harbor_restore_uploads_ci/ci-backup-sentinel.txt") == 'disposable backup fixture' ]] || { echo 'Restored attachment differs' >&2; exit 1; }
node scripts/backup-fixture-ci.mjs attachment-sql "$BACKUP_DIR/fixture.json" > "$BACKUP_DIR/attachment.sql"
storage_key=$(docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d harbor_restore_ci -At' < "$BACKUP_DIR/attachment.sql")
node scripts/backup-fixture-ci.mjs assert-upload "$BACKUP_DIR/fixture.json" "$storage_key" "$RUNNER_TEMP/harbor_restore_uploads_ci"
# A second restore MUST refuse the existing database and directory.
if ./scripts/restore.sh "${dump[0]}" harbor_restore_ci; then echo 'Unsafe database overwrite accepted' >&2; exit 1; fi
if python3 scripts/restore-uploads.py "${archive[0]}" "$RUNNER_TEMP/harbor_restore_uploads_ci"; then echo 'Unsafe file overwrite accepted' >&2; exit 1; fi
printf 'Real Compose community/Ticket/Bot backup, private attachment and isolated non-overwriting restore acceptance passed.\n'
