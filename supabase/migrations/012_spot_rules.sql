-- FreiPark: parking rules (SPEC-parking-rules.md).
--
-- Part 1 (PR1): street parking mapped as its own area — Berlin's ~42k
-- amenity=parking + parking=street_side|lane|on_kerb|half_on_kerb|shoulder
-- areas — was stored as 'lot' because the import only recognised the old
-- parking:lane tags. They are kerbside parking: 'street'. This also gives
-- spot reports the 150 m street radius (report_spot, 007) instead of 300 m.
-- The import's _spot_type() does the same from now on; keep the list in
-- sync with STREET_PARKING_KINDS in backend/scripts/import_osm.py.
--
-- Only rows that change are touched. Run as supabase_admin. Safe to re-run.

BEGIN;

SET LOCAL statement_timeout = '15min';

UPDATE parking_spots
   SET spot_type = 'street'
 WHERE spot_type = 'lot'
   AND tags->>'parking' IN ('street_side', 'lane', 'on_kerb', 'half_on_kerb', 'shoulder');

-- Part 2 (PR2): spot_details also returns the spot's rule tags, for the
-- app's "Paid now until 20:00" line: an allow-list of rule keys with text
-- values, so the payload holds only what the line needs. (Not a privacy
-- boundary: parking_spots, tags included, is public OSM data and publicly
-- readable by design — CLAUDE.md § RLS.) The
-- result columns change, so the function is dropped and recreated;
-- rollback: supabase/self-host/rollback_012_spot_rules.sql.

DROP FUNCTION IF EXISTS public.spot_details(uuid);

CREATE FUNCTION public.spot_details(p_spot_id uuid)
RETURNS TABLE (
  address_street      text,
  address_housenumber text,
  address_postcode    text,
  address_source      text,
  city_name           text,
  rule_tags           jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT ps.address_street, ps.address_housenumber, ps.address_postcode,
         ps.address_source, c.name,
         (SELECT coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
            FROM jsonb_each(ps.tags) AS t
           WHERE jsonb_typeof(t.value) = 'string'
             AND t.key IN ('fee', 'fee:conditional', 'maxstay', 'maxstay:conditional',
                           'restriction', 'restriction:conditional', 'zone', 'access',
                           'access:conditional', 'authentication:disc', 'parking:disc'))
    FROM parking_spots ps
    JOIN cities c ON c.id = ps.city_id
   WHERE ps.id = p_spot_id;
$$;

REVOKE EXECUTE ON FUNCTION public.spot_details(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.spot_details(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
