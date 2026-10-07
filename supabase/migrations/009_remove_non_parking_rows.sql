-- FreiPark: remove imported rows that are not car parking.
--
-- osmium tags-filter keeps every object a match references (a car park's
-- outline nodes, a street-parking way's nodes), and osmium export emitted
-- any of those with tags of their own as separate features. Before the
-- import fix (backend/scripts/import_osm.py, _is_parking_feature) they all
-- became "spots": barriers, crossings, kerbs, garage entrances/exits,
-- charging stations, waste baskets, bike racks, member ways of multipolygon
-- car parks... ~34,000 rows (~6%). See SPEC-infra.md § OSM Import Pipeline.
--
-- Same rule as the importer: keep amenity=parking / parking_space (any OSM
-- type) and ways with a parking:lane:left/right/both tag; delete the rest.
-- coalesce() matters: NULL IN (...) is NULL, not false, so without it rows
-- with no amenity tag would silently survive.
--
-- Spot reports on deleted rows go too (ON DELETE CASCADE). Re-imports never
-- delete, so this is the only way old rows leave; running it again is a
-- no-op.
--
-- Run as supabase_admin (see SPEC-infra.md § Self-Hosted Supabase Migration).

BEGIN;

DELETE FROM parking_spots
 WHERE NOT (
   coalesce(tags->>'amenity', '') IN ('parking', 'parking_space')
   OR (osm_type = 'way'
       AND tags ?| array['parking:lane:left', 'parking:lane:right', 'parking:lane:both'])
 );

COMMIT;
