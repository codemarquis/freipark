#!/usr/bin/env bash
# Daily purge of old crowdsourced spot reports (SPEC-spot-reports.md
# § Privacy / Open Questions; tasks/plan.md § R8).
#
# Reports are only shown for 30 minutes; older rows are kept for a while
# to tune that window, then deleted. The DELETE itself lives in the
# purge_spot_reports() function (migration 007) so it's covered by the DB
# tests; this script just calls it as supabase_admin.
#
# Run from anywhere: cd /path/to/freipark && ./supabase/self-host/purge_spot_reports.sh
# Proposed cron (UTC), after the 03:00 backup:
#   30 3 * * * /path/to/freipark/supabase/self-host/purge_spot_reports.sh >> ~/freipark-purge.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/../.."

RETENTION_DAYS="${FREIPARK_REPORT_RETENTION_DAYS:-30}"
# The OVH box needs sudo for docker (same as backup_db.sh); override
# locally with FREIPARK_DOCKER=docker.
DOCKER="${FREIPARK_DOCKER:-sudo docker}"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo "[purge] FREIPARK_REPORT_RETENTION_DAYS must be a whole number >= 1, got '${RETENTION_DAYS}'" >&2
  exit 1
fi

echo "[purge] $(date -u +%Y-%m-%dT%H:%M:%SZ) deleting spot reports older than ${RETENTION_DAYS} days..."
DELETED=$($DOCKER compose exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At \
  -c "SELECT purge_spot_reports(${RETENTION_DAYS})")
echo "[purge] done: ${DELETED} report(s) deleted"
