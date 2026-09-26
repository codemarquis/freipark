#!/usr/bin/env bash
# Generates the gitignored, real config files for self-hosted Supabase
# (SS2) from their committed .template counterparts, substituting secrets
# from backend/.env (SS1):
#   kong.yml.template                    -> kong.yml
#   init/zz-set-role-passwords.sql.template -> init/zz-set-role-passwords.sql
# The "zz-" prefix is deliberate: supabase/postgres's own bundled
# migrate.sh (also in /docker-entrypoint-initdb.d/) creates the
# authenticator/supabase_auth_admin roles this script alters, and
# alphabetical ordering must put this script after it.
# Re-run this any time the underlying secrets change, before
# `docker compose up db kong` (db only reads its init script on first
# initialization of an empty volume — re-running after that requires
# recreating the volume too).
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="../../backend/.env"

SUPABASE_SELFHOSTED_ANON_KEY=$(grep -E '^SUPABASE_SELFHOSTED_ANON_KEY=' "$ENV_FILE" | cut -d= -f2-)
SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY=$(grep -E '^SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2-)
SUPABASE_SELFHOSTED_DB_PASSWORD=$(grep -E '^SUPABASE_SELFHOSTED_DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$SUPABASE_SELFHOSTED_ANON_KEY" ] || [ -z "$SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY" ]; then
  echo "Missing SUPABASE_SELFHOSTED_ANON_KEY or SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY in $ENV_FILE (run SS1 first)." >&2
  exit 1
fi
if [ -z "$SUPABASE_SELFHOSTED_DB_PASSWORD" ]; then
  echo "Missing SUPABASE_SELFHOSTED_DB_PASSWORD in $ENV_FILE." >&2
  exit 1
fi

export SUPABASE_SELFHOSTED_ANON_KEY SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY SUPABASE_SELFHOSTED_DB_PASSWORD

envsubst '${SUPABASE_SELFHOSTED_ANON_KEY} ${SUPABASE_SELFHOSTED_SERVICE_ROLE_KEY}' \
  < kong.yml.template > kong.yml
echo "Wrote $(pwd)/kong.yml"

envsubst '${SUPABASE_SELFHOSTED_DB_PASSWORD}' \
  < init/zz-set-role-passwords.sql.template > init/zz-set-role-passwords.sql
echo "Wrote $(pwd)/init/zz-set-role-passwords.sql"
