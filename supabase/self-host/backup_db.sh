#!/usr/bin/env bash
# Daily backup of the self-hosted Postgres instance to Cloudflare R2 (SS9,
# see SPEC-infra.md § Self-Hosted Supabase Migration (Proposed) and
# tasks/plan.md § SS9).
#
# Requires: an `rclone` remote named `r2:` already configured
# (S3-compatible, Cloudflare provider) with write access to the target
# bucket, and this script run from somewhere `docker compose` resolves
# the freipark project (or run as: cd /path/to/freipark && ./supabase/self-host/backup_db.sh).
#
# --data-only, scoped to just the app's own tables — NOT a full
# schema+data dump. A full dump was tried first and found broken: the
# base supabase/postgres image already creates the auth/storage schemas
# itself, so restoring a full dump into a fresh instance of the same
# image fails with "schema already exists". The real disaster-recovery
# sequence is: fresh stack up (SS2) -> apply supabase/migrations/*.sql
# (SS3, recreates public.cities/parking_spots) -> GoTrue's own startup
# migrations (recreates auth.users/identities structure) -> THEN this
# backup's data restores cleanly on top. Matches the same tables SS5
# migrated from managed, and the same "no --disable-triggers" lesson
# from SS5/SS6: real FK/trigger enforcement stays on during restore.
set -euo pipefail

cd "$(dirname "$0")/../.."

BUCKET="${FREIPARK_BACKUP_BUCKET:-freipark-tiles}"
PREFIX="backups/db"
RETENTION_DAYS="${FREIPARK_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="/tmp/freipark-db-${TIMESTAMP}.sql.gz"

echo "[backup] dumping self-hosted db (data-only)..."
sudo docker compose exec -T db pg_dump -U supabase_admin -d postgres \
  --data-only --no-owner \
  -t public.cities -t public.parking_spots -t auth.users -t auth.identities \
  | gzip > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[backup] dump complete (${SIZE}), uploading to r2:${BUCKET}/${PREFIX}/..."
rclone copy "$DUMP_FILE" "r2:${BUCKET}/${PREFIX}/"

echo "[backup] pruning backups older than ${RETENTION_DAYS} days..."
rclone delete --min-age "${RETENTION_DAYS}d" "r2:${BUCKET}/${PREFIX}/" || true

rm -f "$DUMP_FILE"
echo "[backup] done: freipark-db-${TIMESTAMP}.sql.gz"
