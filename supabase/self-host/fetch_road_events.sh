#!/usr/bin/env bash
# Autobahn roadworks and closures sweep, every 30 minutes
# (SPEC-road-closures.md § Ingestion; tasks/plan.md § RC7).
#
# Runs backend/scripts/fetch_autobahn.py inside the api container (the
# image ships all of backend/; rebuild it after the script changes:
# `sudo docker compose up -d --build api`). The script connects to the db
# service directly as supabase_admin: libpq takes the password from
# PGPASSWORD, so no URL encoding is needed, and backend/.env's own
# DATABASE_URL (which points elsewhere) is overridden.
#
# Run from anywhere: cd /path/to/freipark && ./supabase/self-host/fetch_road_events.sh
# Cron (installed in RC7):
#   */30 * * * * /path/to/freipark/supabase/self-host/fetch_road_events.sh >> ~/freipark-road-events.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/../.."

# The OVH box needs sudo for docker (same as backup_db.sh); override
# locally with FREIPARK_DOCKER=docker.
DOCKER="${FREIPARK_DOCKER:-sudo docker}"

# -T: no TTY under cron. Single quotes: the variable expands inside the
# container, where backend/.env provides it.
$DOCKER compose exec -T api sh -c \
  'PGPASSWORD="$SUPABASE_SELFHOSTED_DB_PASSWORD" DATABASE_URL="host=db port=5432 user=supabase_admin dbname=postgres" exec python scripts/fetch_autobahn.py'
