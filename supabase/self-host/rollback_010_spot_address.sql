-- Rollback for supabase/migrations/010_spot_address.sql (tasks/plan.md SA7).
--
-- Removes spot_details() and the five address columns. App builds that
-- call spot_details then simply show no address line (useSpotDetails
-- treats any error as "no address"); coordinates still show.
-- Safe to re-run.
--
-- Run as supabase_admin:
--   cd ~/freipark && sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 \
--     -U supabase_admin -d postgres < supabase/self-host/rollback_010_spot_address.sql

BEGIN;

DROP FUNCTION IF EXISTS public.spot_details(uuid);

ALTER TABLE parking_spots DROP CONSTRAINT IF EXISTS parking_spots_address_source_check;
ALTER TABLE parking_spots
  DROP COLUMN IF EXISTS address_street,
  DROP COLUMN IF EXISTS address_housenumber,
  DROP COLUMN IF EXISTS address_postcode,
  DROP COLUMN IF EXISTS address_source,
  DROP COLUMN IF EXISTS address_distance_m;

COMMIT;
