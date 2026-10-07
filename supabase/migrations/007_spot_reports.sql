-- FreiPark: crowdsourced spot reports ("free" / "full")
--
-- See SPEC-spot-reports.md. Signed-in users report whether a spot has
-- space; reports expire 30 minutes after they're made. Clients never touch
-- the table directly: writes go through report_spot(), reads through
-- spots_in_bbox(). Neither returns user_id, so nobody can see who reported
-- what.
--
-- Run via: psql against the self-hosted instance as supabase_admin (see
-- SPEC-infra.md § Self-Hosted Supabase Migration for the apply procedure).

BEGIN;

CREATE TABLE IF NOT EXISTS spot_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id     UUID        NOT NULL REFERENCES parking_spots(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('free', 'full')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  distance_m  REAL        NOT NULL   -- reporter→spot distance at submit time; audit only
);
-- No stored expires_at: a report is active while
-- reported_at > now() - interval '30 minutes'. (A generated column can't
-- do this — timestamptz + interval isn't immutable, it depends on TimeZone.)

-- Latest report per spot (read path) and per-user rate limits (write path)
CREATE INDEX IF NOT EXISTS idx_spot_reports_spot_latest
  ON spot_reports (spot_id, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_spot_reports_user_recent
  ON spot_reports (user_id, reported_at DESC);

-- RLS on with no client policies, and no client grants: Supabase's default
-- privileges grant ALL on new public tables to anon/authenticated, so
-- revoke explicitly rather than rely on RLS alone.
ALTER TABLE spot_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spot_reports FROM anon, authenticated;

-- Write path. SECURITY DEFINER so it can insert past RLS; search_path is
-- pinned so a caller can't shadow public objects with their own.
CREATE OR REPLACE FUNCTION public.report_spot(
  p_spot_id uuid,
  p_status  text,
  p_lon     float8,
  p_lat     float8
)
RETURNS TABLE (
  status      text,
  reported_at timestamptz,
  expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_user_id   uuid := auth.uid();
  v_spot_type text;
  v_distance  float8;
  v_max_m     float8;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'not_authenticated';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('free', 'full') THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_status';
  END IF;

  SELECT ps.spot_type,
         ST_Distance(ps.location::geography,
                     ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
    INTO v_spot_type, v_distance
    FROM parking_spots ps
   WHERE ps.id = p_spot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'spot_not_found';
  END IF;

  -- Street spots are points; lots/garages/zones are areas whose centroid
  -- can sit far from where a driver stands. Mirrored in the frontend's
  -- reportStatus.ts maxRadiusFor().
  v_max_m := CASE WHEN v_spot_type = 'street' THEN 150 ELSE 300 END;
  IF v_distance IS NULL OR v_distance > v_max_m THEN
    RAISE EXCEPTION USING MESSAGE = 'too_far';
  END IF;

  IF EXISTS (
    SELECT 1 FROM spot_reports r
     WHERE r.user_id = v_user_id
       AND r.spot_id = p_spot_id
       AND r.reported_at > now() - INTERVAL '5 minutes'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'rate_limited_spot';
  END IF;

  IF (
    SELECT count(*) FROM spot_reports r
     WHERE r.user_id = v_user_id
       AND r.reported_at > now() - INTERVAL '60 minutes'
  ) >= 20 THEN
    RAISE EXCEPTION USING MESSAGE = 'rate_limited_hourly';
  END IF;

  RETURN QUERY
    INSERT INTO spot_reports AS r (spot_id, user_id, status, distance_m)
    VALUES (p_spot_id, v_user_id, p_status, v_distance)
    RETURNING r.status, r.reported_at, r.reported_at + INTERVAL '30 minutes';
END;
$$;

-- Supabase's default privileges also grant EXECUTE on new functions to
-- anon; only signed-in users may report.
REVOKE EXECUTE ON FUNCTION public.report_spot(uuid, text, float8, float8) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.report_spot(uuid, text, float8, float8) TO authenticated;

-- Read path: spots_in_bbox (002) gains report_status / report_at — the
-- latest active report per spot. Same arguments, defaults and first seven
-- columns as before, so app builds that predate this ignore the extras.
-- A return-type change needs DROP + CREATE (not CREATE OR REPLACE); this
-- whole file is one transaction, so callers never see it missing.
DROP FUNCTION IF EXISTS public.spots_in_bbox(float8, float8, float8, float8, int);

CREATE FUNCTION public.spots_in_bbox(
  min_lon  float8,
  min_lat  float8,
  max_lon  float8,
  max_lat  float8,
  lim      int DEFAULT 2000
)
RETURNS TABLE (
  id            uuid,
  spot_type     text,
  access        text,
  operator      text,
  capacity      int,
  lon           float8,
  lat           float8,
  report_status text,         -- 'free' | 'full' | NULL (no active report)
  report_at     timestamptz   -- when that report was made; NULL if none
)
-- SECURITY DEFINER because spot_reports has no client grants. It returns
-- only the latest report's status and time, never user_id.
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    ps.id,
    ps.spot_type,
    ps.access,
    ps.operator,
    ps.capacity,
    ST_X(ps.location) AS lon,
    ST_Y(ps.location) AS lat,
    r.status          AS report_status,
    r.reported_at     AS report_at
  FROM (
    -- Pick the spots first, exactly as 002 did, then look up reports for
    -- just those rows.
    SELECT p.id, p.spot_type, p.access, p.operator, p.capacity, p.location
      FROM parking_spots p
     WHERE p.location && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
     LIMIT lim
  ) ps
  LEFT JOIN LATERAL (
    SELECT sr.status, sr.reported_at
      FROM spot_reports sr
     WHERE sr.spot_id = ps.id
       AND sr.reported_at > now() - INTERVAL '30 minutes'
     ORDER BY sr.reported_at DESC
     LIMIT 1
  ) r ON true;
$$;

REVOKE EXECUTE ON FUNCTION public.spots_in_bbox(float8, float8, float8, float8, int) FROM public;
GRANT  EXECUTE ON FUNCTION public.spots_in_bbox(float8, float8, float8, float8, int) TO anon, authenticated;

COMMIT;
