-- FreiPark: parking rules (SPEC-parking-rules.md).
--
-- Part 1 (PR1): street parking mapped as its own area — Berlin's 84k
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

COMMIT;
