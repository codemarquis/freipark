-- FreiPark: street address for each parking spot (SPEC-spot-address.md).
--
-- Addresses are worked out once, at import, from OpenStreetMap data
-- (backend/scripts/import_osm.py) — no geocoding API per tap, per the
-- no-per-call-cost rule. First match wins:
--   own_tags         the spot's own addr:street (+ housenumber, postcode)
--   street_name      a street-parking way's own name (the street itself)
--   nearest_address  nearest OSM address point within 60 m  ("near …")
--   nearest_street   nearest named, car-usable street within 60 m ("near …")
-- NULL when nothing is within 60 m; the app then shows coordinates only.
--
-- Read via spot_details() when a spot is tapped, so spots_in_bbox — the
-- query behind every map pan — stays unchanged.
--
-- Run as supabase_admin. Safe to re-run.

BEGIN;

ALTER TABLE parking_spots
  ADD COLUMN IF NOT EXISTS address_street      text,
  ADD COLUMN IF NOT EXISTS address_housenumber text,
  ADD COLUMN IF NOT EXISTS address_postcode    text,
  ADD COLUMN IF NOT EXISTS address_source      text,
  ADD COLUMN IF NOT EXISTS address_distance_m  real;  -- 0 for own_tags / street_name

ALTER TABLE parking_spots DROP CONSTRAINT IF EXISTS parking_spots_address_source_check;
ALTER TABLE parking_spots ADD CONSTRAINT parking_spots_address_source_check
  CHECK (address_source IN ('own_tags', 'street_name', 'nearest_address', 'nearest_street'));

CREATE OR REPLACE FUNCTION public.spot_details(p_spot_id uuid)
RETURNS TABLE (
  address_street      text,
  address_housenumber text,
  address_postcode    text,
  address_source      text,
  city_name           text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT ps.address_street, ps.address_housenumber, ps.address_postcode,
         ps.address_source, c.name
    FROM parking_spots ps
    JOIN cities c ON c.id = ps.city_id
   WHERE ps.id = p_spot_id;
$$;

REVOKE EXECUTE ON FUNCTION public.spot_details(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.spot_details(uuid) TO anon, authenticated;

COMMIT;
