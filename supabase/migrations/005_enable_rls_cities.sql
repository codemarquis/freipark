-- FreiPark: enable RLS on cities
--
-- Supabase's Security Advisor flags any public-schema table exposed via the
-- API with RLS disabled, regardless of whether GRANTs already restrict
-- access. cities was previously left without RLS (see 001_initial_schema.sql:
-- "cities is read-only for all clients (no RLS needed; no sensitive data)")
-- and relied solely on the anon/authenticated GRANT from
-- 003_grant_anon_select.sql. This migration makes that same public-read
-- behavior explicit via RLS instead, so the effective access is unchanged —
-- browsing/search must keep working fully signed-out (see SPEC-auth.md).
--
-- Originally this file also enabled RLS on spatial_ref_sys (a PostGIS
-- system table Supabase's Advisor flags too), but `supabase db push`
-- failed with "must be owner of table spatial_ref_sys" — the role that
-- runs migrations doesn't own extension-owned tables. Split out; see
-- SPEC-infra.md for the current status of that specific warning.
--
-- Run via: supabase db push

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cities_public_read" ON public.cities;
CREATE POLICY "cities_public_read"
  ON public.cities
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies for clients — cities is populated
-- exclusively by the server-side import script using the service role key,
-- which bypasses RLS entirely (same pattern as parking_spots).
