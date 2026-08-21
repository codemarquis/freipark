# Spec: infra — Database, Auth, Storage, and Environment

**Module:** `infra`  
**Capability map:** [CLAUDE.md](CLAUDE.md) → `infra` is the root dependency of all other modules.  
**Status:** Draft — awaiting review before implementation begins.

---

## Objective

Stand up the shared infrastructure layer every other module depends on:

- PostgreSQL + PostGIS on Supabase (cities table, parking spot data, spatial indexes, RLS)
- Supabase Auth (email+password, cross-device JWT sessions)
- Cloudflare R2 bucket configured for PMTiles serving
- Validated schema migration workflow so subsequent modules can add tables cleanly
- Environment config documented and `.env.example` files committed

This module produces no user-visible UI. Success means: any other module can connect to the database, authenticate users, and fetch map tiles without additional infra work.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Database | Supabase (PostgreSQL 15 + PostGIS) | Managed Postgres, free 500MB, built-in auth, RLS, no per-query cost |
| Auth | Supabase Auth (email+password) | 50k MAU free; cross-device JWT; single vendor with DB |
| Map tile storage | Cloudflare R2 | No egress fees (unlike S3); PMTiles served via HTTP range requests |
| Backend runtime | FastAPI (Python 3.12) | Async, Pydantic, strong PostGIS ecosystem |
| Schema migrations | Supabase CLI (`supabase db push`) | Version-controlled SQL files in `supabase/migrations/` |
| OSM data tooling | osmium-tool + psycopg2/asyncpg | osmium for PBF filtering; direct PostGIS COPY for import |

---

## Commands

```bash
# Backend dev server
fastapi dev backend/main.py

# Frontend dev server
npx expo start

# Apply DB migrations (requires supabase CLI + SUPABASE_ACCESS_TOKEN)
supabase db push

# Run OSM import — parameterized by city slug
python backend/scripts/import_osm.py --city berlin

# Run backend tests
cd backend && pytest -v

# Run frontend tests
cd frontend && npx jest
```

---

## Project Structure

```
freipark/
├── CLAUDE.md                       # Role/workflow rules
├── SPEC-infra.md                   # This file
├── tasks/
│   └── plan.md                     # Implementation plan (Phase 2 output)
│
├── backend/
│   ├── main.py                     # FastAPI app entrypoint
│   ├── routers/                    # Route handlers per feature
│   ├── models/                     # Pydantic models
│   ├── db/
│   │   └── connection.py           # asyncpg pool setup
│   ├── scripts/
│   │   ├── import_osm.py           # OSM PBF → PostGIS pipeline (--city <slug>)
│   │   └── download_osm.sh         # Geofabrik download helper
│   ├── tests/
│   │   └── test_db.py              # Infra tests (schema, indexes, RLS)
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── app/                        # Expo Router file-based routes
│   ├── src/
│   │   ├── features/
│   │   │   ├── map/                # MapLibre components (Module: map)
│   │   │   └── auth/               # Login/register screens (Module: auth)
│   │   └── lib/
│   │       └── supabase.ts         # Supabase client singleton
│   ├── package.json
│   └── .env.example
│
└── supabase/
    ├── config.toml                 # Supabase project config
    └── migrations/
        └── 001_initial_schema.sql  # cities + parking_spots tables, indexes, RLS
```

---

## Database Schema (MVP)

### `cities`

The `cities` table makes city a first-class concept rather than a hardcoded value. Adding a second city is inserting a row and running the import — no schema migration required.

Only Berlin is seeded in the MVP. The `geofabrik_url` field drives the import script, making it fully parameterized by city slug.

```sql
CREATE TABLE cities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT        UNIQUE NOT NULL,    -- CLI arg: --city berlin
  name          TEXT        NOT NULL,            -- display name: 'Berlin'
  country_code  TEXT        NOT NULL,            -- ISO 3166-1 alpha-2: 'DE'
  geofabrik_url TEXT        NOT NULL,            -- PBF download URL for this city
  bbox          GEOMETRY(Polygon, 4326),         -- city bounding box; used by osmium to clip PBF
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed row: Berlin (the first city)
INSERT INTO cities (slug, name, country_code, geofabrik_url)
VALUES (
  'berlin',
  'Berlin',
  'DE',
  'https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf'
);
```

### `parking_spots`

The core table. Populated exclusively by the server-side OSM import script; no direct client writes.

```sql
CREATE TABLE parking_spots (
  -- Identity
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     UUID        NOT NULL REFERENCES cities(id),
  osm_id      BIGINT      NOT NULL,
  osm_type    TEXT        NOT NULL
                CHECK (osm_type IN ('node', 'way', 'relation')),

  -- Provenance (Phase 2+ will add 'manual' and 'operator' values)
  source      TEXT        NOT NULL DEFAULT 'osm',

  -- Classification
  spot_type   TEXT        NOT NULL
                CHECK (spot_type IN ('street', 'garage', 'lot', 'zone')),
  access      TEXT
                CHECK (access IN ('free', 'paid', 'permit', 'private')),
  operator    TEXT,                          -- 'EasyPark' | 'ParkNow' | 'Q-Park' | etc.
  capacity    INT,                           -- NULL if unknown (common for street parking)

  -- Geometry
  location    GEOMETRY(Point, 4326)  NOT NULL,  -- centroid (always present)
  geom        GEOMETRY(Geometry, 4326),          -- polygon/linestring for garages/zones (nullable)

  -- Future-proofing (see Phase 2/3 notes below)
  tags        JSONB       NOT NULL DEFAULT '{}', -- raw OSM tags; parsed on-demand, not queried directly

  -- Timestamps
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplication key: OSM IDs are globally unique per type, so this holds across cities.
-- Re-imports upsert by (osm_id, osm_type), keeping the UUID stable.
-- Phase 2 foreign keys to parking_spots.id are safe across re-imports because of this.
CREATE UNIQUE INDEX idx_parking_spots_osm_dedup
  ON parking_spots (osm_id, osm_type);

-- City filter (queries almost always scope to one city)
CREATE INDEX idx_parking_spots_city ON parking_spots (city_id);

-- Spatial indexes for geospatial queries (nearest spots, bounding box)
CREATE INDEX idx_parking_spots_location
  ON parking_spots USING GIST (location);

CREATE INDEX idx_parking_spots_geom
  ON parking_spots USING GIST (geom)
  WHERE geom IS NOT NULL;

-- Filtering indexes
CREATE INDEX idx_parking_spots_spot_type ON parking_spots (spot_type);
CREATE INDEX idx_parking_spots_access    ON parking_spots (access);
```

**Design notes:**
- `city_id` FK → all spot queries scope to a city; adding Munich later is `INSERT INTO cities (...)` + one import run.
- `osm_id` + `osm_type` dedup → import does `INSERT ... ON CONFLICT (osm_id, osm_type) DO UPDATE`. UUID primary key never changes across re-imports; Phase 2 FK references to `id` are safe.
- `source = 'osm'` default → Phase 2 inserts rows with `source = 'manual'` without a schema change.
- `tags JSONB` → stores the full OSM tag map. Phase 2/3 can parse `parking:lane`, `maxstay`, `fee`, `capacity:disabled` without migrations.
- No `status` or `available` column → real-time availability is Phase 2 scope. A nullable column now would be misleading; computed from the reports table instead.

### RLS Policies

```sql
ALTER TABLE parking_spots ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated users) can read spots
CREATE POLICY "spots_public_read"
  ON parking_spots FOR SELECT
  USING (true);

-- No direct client writes; all inserts/updates go through the server-side
-- import script using the service role key, which bypasses RLS.
```

---

## OSM Import Pipeline

The import script is the only writer to `parking_spots`. It is fully parameterized by city slug:

```bash
python backend/scripts/import_osm.py --city berlin
```

**What the script does:**
1. Reads the `cities` row for `slug = 'berlin'` to get `geofabrik_url` and `bbox`
2. Downloads the PBF from `geofabrik_url` if not already cached
3. Runs `osmium tags-filter` to extract parking-related features (`amenity=parking`, `parking=*`, `parking:lane=*`)
4. Optionally clips to `bbox` using `osmium extract --bbox`
5. Imports via `COPY` into a staging table, then upserts into `parking_spots` on conflict `(osm_id, osm_type)`
6. Logs row count delta (inserted / updated / unchanged)

Adding a new city: insert a row into `cities` with the Geofabrik URL, then run the script with the new slug. No code changes needed.

---

## Cloudflare R2: PMTiles Setup

R2 bucket hosts city vector tile files served via HTTP range requests to MapLibre. Object names are per-city (e.g. `berlin.pmtiles`).

**Bucket configuration:**
- Bucket name: `freipark-tiles`
- Public access: enabled (read-only, no credentials needed from client)
- CORS: allow `GET` from all origins (required for range requests from mobile)
- Object: `berlin.pmtiles` (~300–500MB, updated when tile data is regenerated)

**Source:** Protomaps daily builds, or generate from the Geofabrik Berlin PBF via `pmtiles convert`.

**Client config (frontend `.env`):**
```
EXPO_PUBLIC_PMTILES_URL=https://pub-<hash>.r2.dev/berlin.pmtiles
```

No request signing required; R2 public bucket serves files directly. Zero per-request cost.

---

## Environment Variables

### `backend/.env.example`

```bash
# Supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # bypasses RLS; server-side only, never expose

# Direct DB connection (for OSM import script using asyncpg/psycopg2)
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

# App
ENVIRONMENT=development   # 'development' | 'production'
LOG_LEVEL=info
```

### `frontend/.env.example`

```bash
# Supabase (anon key is safe to expose; RLS enforces access)
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Map tiles (per-city PMTiles URL)
EXPO_PUBLIC_PMTILES_URL=https://pub-<hash>.r2.dev/berlin.pmtiles
```

**Never commit:** Actual `.env` files, `SERVICE_ROLE_KEY`, `DATABASE_URL` with credentials.

---

## Code Style

Supabase client singleton (frontend pattern used across all modules):

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'  // generated by: supabase gen types typescript

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnon)
```

Backend DB query (Pydantic + asyncpg pattern):

```python
# models/spot.py
from pydantic import BaseModel, UUID4
from typing import Literal

class ParkingSpot(BaseModel):
    id: UUID4
    city_id: UUID4
    osm_id: int
    spot_type: Literal['street', 'garage', 'lot', 'zone']
    access: Literal['free', 'paid', 'permit', 'private'] | None
    operator: str | None
    capacity: int | None
    lat: float
    lon: float
```

**Conventions:**
- No `any` types in TypeScript; no untyped dicts in Python (strict Pydantic)
- Database types generated via `supabase gen types typescript` — never hand-written
- All SQL in `supabase/migrations/` as numbered files (`001_`, `002_`, ...); no ad-hoc schema changes
- Migration files are append-only; never edit a migration that has been pushed to the project

---

## Testing Strategy

**Framework:** pytest (backend), Jest + React Native Testing Library (frontend)

**Infra-specific tests** (`backend/tests/test_db.py`):

```python
# Verify PostGIS extension
async def test_postgis_enabled():
    result = await db.fetchval("SELECT PostGIS_version()")
    assert result is not None

# Verify Berlin seed row exists
async def test_berlin_city_seeded():
    row = await db.fetchrow("SELECT slug FROM cities WHERE slug = 'berlin'")
    assert row is not None

# Verify spatial index is used for nearest-spot queries
async def test_spatial_index_on_location():
    plan = await db.fetchval("""
        EXPLAIN SELECT id FROM parking_spots
        ORDER BY location <-> ST_MakePoint(13.405, 52.52)::geometry
        LIMIT 10
    """)
    assert 'Index Scan' in plan

# Verify RLS: anon key can SELECT, cannot INSERT
async def test_rls_read_only_for_anon():
    rows = await anon_client.table('parking_spots').select('id').limit(1).execute()
    assert rows.data is not None
    with pytest.raises(Exception, match='new row violates'):
        await anon_client.table('parking_spots').insert({...}).execute()
```

**Infra tests run against the local Supabase dev instance** (`supabase start`). No database mocking — a mocked schema would not catch RLS policy errors or missing indexes.

---

## Boundaries

**Always:**
- Run `supabase db push` before testing schema-dependent code
- Commit `.env.example` files with every new env var added
- Use `ON CONFLICT (osm_id, osm_type) DO UPDATE` for all OSM imports (idempotent)
- Keep `supabase/migrations/` append-only; never modify a pushed migration
- Pass `--city <slug>` to the import script; never hardcode city name inside the script

**Ask first:**
- Adding new tables or columns (impacts other modules)
- Changing RLS policies (security-critical)
- Upgrading PostGIS or Supabase CLI version
- Adding a new `EXPO_PUBLIC_*` env var (becomes part of public app build)
- Adding a second city's data (requires deciding on multi-city frontend UX first)

**Never:**
- Commit `.env` files or any file containing actual secrets
- Use `SUPABASE_SERVICE_ROLE_KEY` on the frontend (bypasses all RLS)
- Drop or rename columns in a migration (add-only until a formal deprecation cycle)
- Query the Overpass API in production (rate-limited; use Geofabrik PBF for bulk import)
- Hardcode `'berlin'` as a city slug inside application code (always read from `cities` table or config)

---

## Phased Roadmap (Future — Not MVP Scope)

The MVP shows static parking spot locations from OSM. The following phases are documented here so the schema doesn't need to be redesigned later.

### Phase 2: Manual Crowdsourced Reports

*Precondition: small active user base established.*

Users mark a spot as "free" or "taken" via a button tied to a `spot_id` and their account. Reports expire after 30 minutes. Requires auth module to be live.

**Additive schema (no changes to existing tables):**

```sql
CREATE TABLE spot_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id     UUID        NOT NULL REFERENCES parking_spots(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('free', 'taken')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL   -- e.g. reported_at + interval '30 minutes'
);

CREATE INDEX idx_spot_reports_spot_id ON spot_reports (spot_id);
CREATE INDEX idx_spot_reports_expires ON spot_reports (expires_at);
```

Why this is additive: `parking_spots.id` is stable across OSM re-imports (upsert by `osm_id`). The `source` column allows Phase 2 to insert manually-submitted spots without a schema change.

### Phase 3: Passive GPS/Accelerometer Inference

*Precondition: meaningful daily active driving-user volume (Phase 2 proven out).*

Detect probable parking events (vehicle stops) and vacancy events (vehicle resumes moving) from phone motion sensors while the app is active. Data is worthless without real driving-user volume; do not build before Phase 2 validates user engagement.

**Additive schema:**

```sql
CREATE TABLE motion_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL CHECK (event_type IN ('stop', 'depart')),
  location    GEOMETRY(Point, 4326) NOT NULL,
  accuracy_m  FLOAT,
  recorded_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_motion_events_location ON motion_events USING GIST (location);
CREATE INDEX idx_motion_events_recorded ON motion_events (recorded_at);
```

Privacy note: motion events are PII-adjacent. Phase 3 requires a consent flow, data retention policy, and deletion endpoint before launch.

---

## Success Criteria

- [ ] Supabase project exists; PostGIS extension enabled; `cities` and `parking_spots` tables created with all indexes and RLS policies
- [ ] `supabase/migrations/001_initial_schema.sql` committed and applied via `supabase db push`
- [ ] Berlin seed row present in `cities` table (`slug = 'berlin'`)
- [ ] RLS tests pass: anonymous client can SELECT; INSERT is denied; service role bypasses RLS
- [ ] Spatial index test passes: nearest-spot query uses `Index Scan`, not `Seq Scan`
- [ ] Cloudflare R2 bucket `freipark-tiles` created; `berlin.pmtiles` uploaded; CORS configured; public URL resolves
- [ ] `backend/.env.example` and `frontend/.env.example` committed with all required variables documented
- [ ] OSM import script runs end-to-end: `python import_osm.py --city berlin` downloads PBF, filters parking features, inserts rows via upsert-by-`osm_id`, logs row count
- [ ] At least one spot record queryable via `GET /health/db` returning spot count > 0
- [ ] No secrets in git history (`git log -p | grep -i 'supabase\|key\|password'` returns nothing)

---

## Open Questions

None blocking. Resolved before this spec was written:

- ~~Map tile provider~~ → MapLibre + Protomaps PMTiles on Cloudflare R2 (zero per-request cost)
- ~~Auth provider~~ → Supabase Auth, email+password
- ~~Real-time availability~~ → Deferred to Phase 2 (no free data source for street vacancy exists)
- ~~Booking/payments~~ → Out of scope; EasyPark/ParkNow handoff via deep link in spot-finder module
- ~~City hardcoded to Berlin~~ → `cities` table is the first-class concept; import script parameterized by `--city <slug>`
