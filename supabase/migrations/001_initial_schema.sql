-- FreiPark: initial schema
-- Creates the cities lookup table and parking_spots core table with PostGIS
-- spatial indexes and RLS. Berlin is seeded as the first city.
--
-- Run via: supabase db push

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------------------
-- City is a first-class concept. Adding a new city = one INSERT here +
-- one run of the import script (--city <slug>). No schema migration needed.

CREATE TABLE IF NOT EXISTS cities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT        UNIQUE NOT NULL,   -- import CLI arg: --city berlin
  name          TEXT        NOT NULL,           -- display name
  country_code  TEXT        NOT NULL,           -- ISO 3166-1 alpha-2
  geofabrik_url TEXT        NOT NULL,           -- PBF source URL for import script
  bbox          GEOMETRY(Polygon, 4326),        -- city bounding box; used by osmium --bbox
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Berlin (first city)
INSERT INTO cities (slug, name, country_code, geofabrik_url)
VALUES (
  'berlin',
  'Berlin',
  'DE',
  'https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf'
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- parking_spots
-- ---------------------------------------------------------------------------
-- Populated exclusively by the server-side import script (service role key).
-- All OSM IDs are globally unique per type, so the dedup key holds across cities.

CREATE TABLE IF NOT EXISTS parking_spots (
  -- Identity
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     UUID        NOT NULL REFERENCES cities(id),
  osm_id      BIGINT      NOT NULL,
  osm_type    TEXT        NOT NULL
                CHECK (osm_type IN ('node', 'way', 'relation')),

  -- Provenance — 'osm' for all MVP data; 'manual' / 'operator' reserved for Phase 2+
  source      TEXT        NOT NULL DEFAULT 'osm',

  -- Classification
  spot_type   TEXT        NOT NULL
                CHECK (spot_type IN ('street', 'garage', 'lot', 'zone')),
  access      TEXT
                CHECK (access IN ('free', 'paid', 'permit', 'private')),
  operator    TEXT,         -- e.g. 'EasyPark', 'ParkNow', 'Q-Park'
  capacity    INT,          -- NULL if unknown (typical for street parking)

  -- Geometry
  location    GEOMETRY(Point, 4326)    NOT NULL,  -- centroid; always present
  geom        GEOMETRY(Geometry, 4326),            -- polygon/line for garages/zones

  -- Raw OSM tags — parsed on-demand in Phase 2/3; avoids premature column explosion
  tags        JSONB        NOT NULL DEFAULT '{}',

  -- Timestamps
  imported_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Deduplication: import upserts on (osm_id, osm_type).
-- UUID primary key stays stable across re-imports → Phase 2 FKs are safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_spots_osm_dedup
  ON parking_spots (osm_id, osm_type);

-- City filter — almost every query is city-scoped
CREATE INDEX IF NOT EXISTS idx_parking_spots_city
  ON parking_spots (city_id);

-- Spatial — nearest-spot KNN and bounding-box queries
CREATE INDEX IF NOT EXISTS idx_parking_spots_location
  ON parking_spots USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_parking_spots_geom
  ON parking_spots USING GIST (geom)
  WHERE geom IS NOT NULL;

-- Categorical filters
CREATE INDEX IF NOT EXISTS idx_parking_spots_spot_type
  ON parking_spots (spot_type);

CREATE INDEX IF NOT EXISTS idx_parking_spots_access
  ON parking_spots (access);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE parking_spots ENABLE ROW LEVEL SECURITY;

-- Public read: browsing spots requires no auth
DROP POLICY IF EXISTS "spots_public_read" ON parking_spots;
CREATE POLICY "spots_public_read"
  ON parking_spots
  FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policies for clients.
-- The import script runs with the service role key, which bypasses RLS entirely.

-- cities is read-only for all clients (no RLS needed; no sensitive data)
