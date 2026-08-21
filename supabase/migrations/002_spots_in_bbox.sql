-- RPC for viewport-bounded parking spot queries.
-- Called by the frontend anon client on every map region change.
-- Returns at most `lim` spots (default 2000) within the given bounding box.

CREATE OR REPLACE FUNCTION public.spots_in_bbox(
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

-- Allow unauthenticated (anon) and authenticated users to call this function.
-- Spot data is intentionally public (no PII, RLS SELECT policy already open).
GRANT EXECUTE ON FUNCTION public.spots_in_bbox TO anon, authenticated;
