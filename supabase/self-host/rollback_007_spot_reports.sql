-- Rollback for supabase/migrations/007_spot_reports.sql (tasks/plan.md R10).
--
-- Puts the database back exactly as 002 left it: spots_in_bbox with its
-- original seven columns (not SECURITY DEFINER, no search_path), and none
-- of 007's objects. DESTROYS every spot report — take a backup first
-- (backup_db.sh includes spot_reports once this repo is pulled).
--
-- Run as supabase_admin, same as the migration:
--   cd ~/freipark && sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 \
--     -U supabase_admin -d postgres < supabase/self-host/rollback_007_spot_reports.sql
-- Safe to re-run. Old app builds keep working throughout (they only read
-- the seven original columns); new builds lose the report UI's data.

BEGIN;

DROP FUNCTION IF EXISTS public.purge_spot_reports(int);
DROP FUNCTION IF EXISTS public.report_spot(uuid, text, float8, float8);

-- spots_in_bbox: restore 002's definition. Return type changes back, so
-- DROP + CREATE (not CREATE OR REPLACE), and the grant is re-issued.
DROP FUNCTION IF EXISTS public.spots_in_bbox(float8, float8, float8, float8, int);

CREATE FUNCTION public.spots_in_bbox(
  min_lon  float8,
  min_lat  float8,
  max_lon  float8,
  max_lat  float8,
  lim      int DEFAULT 2000
)
RETURNS TABLE (
  id        uuid,
  spot_type text,
  access    text,
  operator  text,
  capacity  int,
  lon       float8,
  lat       float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    ps.id,
    ps.spot_type,
    ps.access,
    ps.operator,
    ps.capacity,
    ST_X(ps.location) AS lon,
    ST_Y(ps.location) AS lat
  FROM parking_spots ps
  WHERE ps.location && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.spots_in_bbox TO anon, authenticated;

DROP TABLE IF EXISTS public.spot_reports;

COMMIT;
