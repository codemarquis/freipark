-- FreiPark: waitlist signups
--
-- Backs the standalone landing page's email capture form. Public clients
-- (anon key) may INSERT their own signup but never read, update, or delete
-- rows — same write-only-from-client shape used elsewhere (cities,
-- parking_spots), just inverted: here the client writes and only the
-- service role reads.
--
-- Run via: psql against the self-hosted instance (see SPEC-infra.md
-- § Self-Hosted Supabase Migration for the apply procedure).

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL UNIQUE,
  source     TEXT        NOT NULL DEFAULT 'landing-page',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_public_insert" ON waitlist;
CREATE POLICY "waitlist_public_insert"
  ON waitlist
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- No SELECT/UPDATE/DELETE policies for clients — signups are read only via
-- the service role key (e.g. for export/CSV, a future admin view).
GRANT INSERT ON waitlist TO anon;
