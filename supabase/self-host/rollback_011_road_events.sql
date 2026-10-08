-- Rollback for supabase/migrations/011_road_events.sql (tasks/plan.md RC7).
--
-- Removes road_events_in_bbox() and the road_events table. Take the
-- fetch_road_events.sh cron line out first, or the next sweep fails
-- (harmlessly) on the missing table. App builds with the road layer then
-- show no lines (useRoadEvents treats any error as "no events"); spots
-- are unaffected. The data needs no backup: the Autobahn sweep and the
-- OSM construction import rebuild it. Safe to re-run.
--
-- Run as supabase_admin:
--   cd ~/freipark && sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 \
--     -U supabase_admin -d postgres < supabase/self-host/rollback_011_road_events.sql

BEGIN;

DROP FUNCTION IF EXISTS public.road_events_in_bbox(float8, float8, float8, float8, int);
DROP TABLE IF EXISTS public.road_events;

NOTIFY pgrst, 'reload schema';

COMMIT;
