-- FreiPark: roadworks and closures (SPEC-road-closures.md).
--
-- Filled on the server only: backend/scripts/fetch_autobahn.py every 30 min
-- (all motorway roadworks and closures from the Autobahn API) and
-- backend/scripts/import_osm_construction.py with the OSM import (roads
-- under construction). The app never calls those sources; it reads this
-- table through road_events_in_bbox(), so there is no per-user cost.
--
-- Run as supabase_admin. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS road_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL CHECK (source IN ('autobahn', 'osm')),
  source_id   text        NOT NULL,          -- Autobahn identifier, or OSM "way/123"
  kind        text        NOT NULL CHECK (kind IN
                ('closure', 'entry_exit_closure', 'roadworks', 'short_term_roadworks', 'construction')),
  road        text,                          -- "A100", or the OSM street name
  title       text        NOT NULL,
  subtitle    text,                          -- direction, for Autobahn items
  description text[]      NOT NULL DEFAULT '{}',
  starts_at   timestamptz,
  ends_at     timestamptz,                   -- when the source gives one
  geom        geometry(Geometry, 4326) NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_road_events_geom ON road_events USING gist (geom);

-- No client access to the table itself; reads go through the function below.
ALTER TABLE road_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON road_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.road_events_in_bbox(
  min_lon float8,
  min_lat float8,
  max_lon float8,
  max_lat float8,
  lim     int DEFAULT 2000
)
RETURNS TABLE (
  id          uuid,
  kind        text,
  road        text,
  title       text,
  subtitle    text,
  description text[],
  starts_at   timestamptz,
  ends_at     timestamptz,
  geometry    text           -- GeoJSON, ready for a MapLibre source
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT e.id, e.kind, e.road, e.title, e.subtitle, e.description,
         e.starts_at, e.ends_at, ST_AsGeoJSON(e.geom)
    FROM road_events e
   WHERE e.geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
   LIMIT lim;
$$;

REVOKE EXECUTE ON FUNCTION public.road_events_in_bbox(float8, float8, float8, float8, int) FROM public;
GRANT  EXECUTE ON FUNCTION public.road_events_in_bbox(float8, float8, float8, float8, int) TO anon, authenticated;

COMMIT;
