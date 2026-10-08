-- Rollback for supabase/migrations/012_spot_rules.sql (tasks/plan.md PR6).
--
-- Restores spot_details() as migration 010 defined it (no rule_tags). App
-- builds with the rule line then show "Rules unknown — check the signs"
-- (useSpotDetails treats a missing rule_tags as none); addresses keep
-- working. Part 1's spot_type fix is deliberately NOT undone: street
-- parking areas really are street parking (re-importing would set them
-- again anyway). Safe to re-run.
--
-- Run as supabase_admin:
--   cd ~/freipark && sudo docker compose exec -T db psql -v ON_ERROR_STOP=1 \
--     -U supabase_admin -d postgres < supabase/self-host/rollback_012_spot_rules.sql

BEGIN;

DROP FUNCTION IF EXISTS public.spot_details(uuid);

CREATE FUNCTION public.spot_details(p_spot_id uuid)
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

NOTIFY pgrst, 'reload schema';

COMMIT;
