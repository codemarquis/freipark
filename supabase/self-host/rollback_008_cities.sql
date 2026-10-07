-- Rollback for supabase/migrations/008_add_cities_over_100k.sql.
--
-- Removes the 47 cities 008 added and every parking spot imported for them
-- (spot reports on those spots go too, via ON DELETE CASCADE). Leaves 004's
-- 33 cities and their spots untouched. Safe to re-run.
--
-- Run as supabase_admin:
--   cd ~/freipark && sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 \
--     -U supabase_admin -d postgres < supabase/self-host/rollback_008_cities.sql

BEGIN;

CREATE TEMP TABLE rollback_008_slugs (slug text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rollback_008_slugs (slug) VALUES
  ('aachen'),
  ('bergisch-gladbach'),
  ('bielefeld'),
  ('bochum'),
  ('bottrop'),
  ('gelsenkirchen'),
  ('hagen'),
  ('hamm'),
  ('herne'),
  ('krefeld'),
  ('leverkusen'),
  ('moers'),
  ('monchengladbach'),
  ('mulheim'),
  ('neuss'),
  ('oberhausen'),
  ('paderborn'),
  ('recklinghausen'),
  ('remscheid'),
  ('siegen'),
  ('solingen'),
  ('wuppertal'),
  ('erlangen'),
  ('furth'),
  ('ingolstadt'),
  ('regensburg'),
  ('wurzburg'),
  ('heidelberg'),
  ('heilbronn'),
  ('pforzheim'),
  ('reutlingen'),
  ('ulm'),
  ('darmstadt'),
  ('kassel'),
  ('offenbach'),
  ('gottingen'),
  ('oldenburg'),
  ('osnabruck'),
  ('salzgitter'),
  ('wolfsburg'),
  ('kaiserslautern'),
  ('koblenz'),
  ('ludwigshafen'),
  ('trier'),
  ('jena'),
  ('cottbus'),
  ('frankfurt-oder');

DELETE FROM parking_spots
 WHERE city_id IN (SELECT c.id FROM cities c JOIN rollback_008_slugs s USING (slug));
DELETE FROM cities WHERE slug IN (SELECT slug FROM rollback_008_slugs);

SELECT 'after rollback: ' || (SELECT count(*) FROM cities) || ' cities, '
       || (SELECT count(*) FROM parking_spots) || ' spots';

COMMIT;
