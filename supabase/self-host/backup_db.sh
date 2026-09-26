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
# A full pg_dump (schema + data, plain SQL, gzip-compressed) — not the
# --data-only approach SS5 used for the one-time managed->self-hosted
# migration. Backups need to rebuild everything from nothing.
set -euo pipefail

cd "$(dirname "$0")/../.."

BUCKET="${FREIPARK_BACKUP_BUCKET:-freipark-tiles}"
PREFIX="backups/db"
RETENTION_DAYS="${FREIPARK_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="/tmp/freipark-db-${TIMESTAMP}.sql.gz"

echo "[backup] dumping self-hosted db..."
sudo docker compose exec -T db pg_dump -U supabase_admin -d postgres | gzip > "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[backup] dump complete (${SIZE}), uploading to r2:${BUCKET}/${PREFIX}/..."
rclone copy "$DUMP_FILE" "r2:${BUCKET}/${PREFIX}/"

echo "[backup] pruning backups older than ${RETENTION_DAYS} days..."
rclone delete --min-age "${RETENTION_DAYS}d" "r2:${BUCKET}/${PREFIX}/" || true

rm -f "$DUMP_FILE"
echo "[backup] done: freipark-db-${TIMESTAMP}.sql.gz"
