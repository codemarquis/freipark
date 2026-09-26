# Spec: infra — Database, Auth, Storage, and Environment

**Module:** `infra`  
**Capability map:** [CLAUDE.md](CLAUDE.md) → `infra` is the root dependency of all other modules.  
**Status:** Implemented (T1–T7 complete). This document has been reconciled
(2026-08-23) against actual repo state; original "Draft" language and a few
now-inaccurate details (Berlin-only seed, no routing infra) are corrected
below. Supabase Auth, listed in the original objective, is **not yet
implemented** — no `src/features/auth` exists; see `CLAUDE.md`'s module
order (`infra → map → auth`) for where it fits next.

**2026-09-26:** a self-hosted replacement for managed Supabase (same
Postgres/PostGIS/Auth/RLS, run on the project's own OVH box instead of
Supabase's cloud) is now specced — see § Self-Hosted Supabase Migration
(Proposed) below. **Proposed only, not implemented** — the tables/RLS/env
vars described elsewhere in this document still reflect the current,
live, managed-Supabase setup.

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
| Database | Supabase (PostgreSQL 15 + PostGIS) | Managed Postgres, free 500MB, built-in auth, RLS, no per-query cost. **Self-hosting proposed** — see § Self-Hosted Supabase Migration (Proposed) |
| Auth | Supabase Auth (email+password) | 50k MAU free; cross-device JWT; single vendor with DB. **Self-hosting proposed** — see § Self-Hosted Supabase Migration (Proposed) |
| Map tile storage | Cloudflare R2 | No egress fees (unlike S3); PMTiles served via HTTP range requests |
| Backend runtime | FastAPI (Python 3.12) | Async, Pydantic, strong PostGIS ecosystem |
| Schema migrations | Supabase CLI (`supabase db push`) | Version-controlled SQL files in `supabase/migrations/` |
| OSM data tooling | osmium-tool + psycopg2/asyncpg | osmium for PBF filtering; direct PostGIS COPY for import |
| Routing engine | Self-hosted OSRM (Docker, `osrm-backend`) | Zero per-call cost, matches the project's hard cost constraint; *not in the original spec* — added to support the map module's routing feature. See § Routing infra |
| TLS / reverse proxy | Caddy 2 | Automatic HTTPS for `api.freipark.com`; terminates TLS in front of the FastAPI `api` service |
| Rate limiting | `slowapi` (FastAPI middleware) | Protects the self-hosted OSRM instance from abuse; 30 req/min on `/route` |

---

## Commands

```bash
# Backend dev server (local, no Docker)
fastapi dev backend/main.py

# Frontend dev server
npx expo start

# Apply DB migrations (requires supabase CLI + SUPABASE_ACCESS_TOKEN)
supabase db push

# Run OSM import — parameterized by city slug
python backend/scripts/import_osm.py --city berlin

# Import all seeded cities in one pass
python backend/scripts/import_all.py

# Run backend tests
cd backend && pytest -v

# Run frontend tests
cd frontend && npx jest

# Full production stack (OSRM + Caddy + API) — see § Routing infra
docker compose up -d
```

---

## Project Structure

```
freipark/
├── CLAUDE.md                       # Role/workflow rules
├── SPEC-infra.md                   # This file
├── SPEC-map.md                     # Map module spec
├── docker-compose.yml              # Production stack: osrm-init, osrm-germany, caddy, api
├── Caddyfile                       # Reverse proxy: api.freipark.com → api:8000
├── tasks/
│   └── plan.md                     # Implementation plan (infra + map)
│
├── backend/
│   ├── main.py                     # FastAPI app entrypoint, mounts routers, rate limiter
│   ├── Dockerfile                  # Container build for the `api` compose service
│   ├── routers/
│   │   ├── health.py               # GET /health/db — per-city spot counts
│   │   ├── route.py                # GET /route — proxies to self-hosted OSRM, rate-limited
│   │   └── regions.py              # Region dispatch by bounding box (currently: germany)
│   ├── db/
│   │   └── connection.py           # asyncpg pool setup
│   ├── scripts/
│   │   ├── import_osm.py           # OSM PBF → PostGIS pipeline (--city <slug>)
│   │   ├── import_all.py           # Runs import_osm.py for every seeded city
│   │   ├── download_osm.sh         # Geofabrik download helper
│   │   └── data/                   # Cached PBF downloads — gitignored
│   ├── tests/
│   │   └── test_db.py              # Infra tests (schema, indexes, RLS)
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── App.tsx                     # Root component (no Expo Router — see SPEC-map.md)
│   ├── src/
│   │   ├── features/
│   │   │   └── map/                # MapLibre + search + routing components (Module: map)
│   │   └── lib/
│   │       └── supabase.ts         # Supabase client singleton
│   ├── package.json
│   └── .env.example
│
└── supabase/
    ├── config.toml                 # Supabase project config
    └── migrations/
        ├── 001_initial_schema.sql      # cities + parking_spots tables, indexes, RLS
        ├── 002_spots_in_bbox.sql       # RPC for viewport-bounded spot queries
        ├── 003_grant_anon_select.sql   # Anon SELECT grant fix
        └── 004_add_german_cities.sql   # Seeds 30+ German cities beyond Berlin
```

**Note:** `frontend/src/features/auth/` does not exist yet — Supabase Auth
is designed for (see § Database Schema and CLAUDE.md's module order) but
not implemented. `backend/models/` (Pydantic models) also doesn't exist as
a separate directory; request/response models currently live inline in
each router file (see `route.py`'s `RouteParams`/`RouteResponse`).

---

## Database Schema (MVP)

### `cities`

The `cities` table makes city a first-class concept rather than a hardcoded value. Adding a second city is inserting a row and running the import — no schema migration required.

**Originally only Berlin was seeded in the MVP; as of migration
`004_add_german_cities.sql`, 30+ major German cities are seeded** —
city-states (Hamburg, Bremen) use their own full-city Geofabrik PBF, while
every other city references its Bundesland (state) PBF plus a `bbox` that
the import script clips with `osmium extract --bbox` before tag-filtering.
See § Seeded Cities below for the full list. The `geofabrik_url` field
drives the import script, making it fully parameterized by city slug.

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

#### Seeded Cities

*(Not in the original spec — added by migration `004_add_german_cities.sql`.)*

30+ cities across every German state, grouped by which Geofabrik PBF they
draw from:

| State PBF | Cities |
|---|---|
| Full-city PBF (city-states, no `bbox`) | Berlin, Hamburg, Bremen |
| `bayern` (Bavaria) | Munich, Nuremberg, Augsburg |
| `nordrhein-westfalen` | Cologne, Düsseldorf, Dortmund, Essen, Duisburg, Bonn, Münster |
| `hessen` | Frankfurt, Wiesbaden |
| `baden-wuerttemberg` | Stuttgart, Karlsruhe, Freiburg, Mannheim |
| `sachsen` (Saxony) | Dresden, Leipzig, Chemnitz |
| `niedersachsen` (Lower Saxony) | Hannover, Braunschweig |
| `brandenburg` | Potsdam |
| `rheinland-pfalz` | Mainz |
| `sachsen-anhalt` | Halle, Magdeburg |
| `thueringen` | Erfurt |
| `schleswig-holstein` | Kiel, Lübeck |
| `mecklenburg-vorpommern` | Rostock |
| `saarland` | Saarbrücken |

Non-city-state entries carry an explicit `bbox` (`ST_MakeEnvelope(...)`) so
`import_osm.py` clips the state-wide PBF down to just that city before
tag-filtering — importing all of Bavaria to get Munich's parking spots
would be wasteful. `backend/scripts/import_all.py` runs the import for
every seeded city in one pass. The full coordinate list is the source of
truth in `supabase/migrations/004_add_german_cities.sql` — not duplicated
here to avoid drift.

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

**Updated 2026-08-25:** `cities` also has RLS enabled now (migration
`005_enable_rls_cities.sql`), with the same public-read policy pattern —
previously it relied solely on the `GRANT SELECT` from
`003_grant_anon_select.sql`, which Supabase's Security Advisor flags as a
warning regardless of GRANTs. Effective access is unchanged (still fully
public read, no auth required), just now also explicit via RLS. Verified
live: anon `GET /rest/v1/cities` still returns rows normally.

`spatial_ref_sys` (a PostGIS system table, not app data) trips the same
Advisor warning but **can't** be fixed via `supabase db push` — that role
doesn't own the table (`must be owner of table spatial_ref_sys`). Left
as-is; would need the Supabase dashboard's SQL Editor (which may run with
different privileges) if it's worth chasing.

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

To import every seeded city in one pass (used for the 30+ cities added by
`004_add_german_cities.sql`), run `python backend/scripts/import_all.py`
instead of calling `import_osm.py` once per city.

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

## Routing infra

*(Not in the original spec — added post-MVP to support the map module's
in-app directions feature. See `SPEC-map.md` § Routing for the client-side
contract.)*

The FastAPI `api` service proxies routing requests to a **self-hosted**
OSRM instance rather than a third-party routing API, keeping per-call cost
at zero — consistent with the project's hard cost constraint. This is the
one piece of infra that runs as a standing Docker Compose stack rather than
a managed service.

**`docker-compose.yml` services:**

| Service | Role |
|---|---|
| `osrm-init` | One-shot: downloads the Germany-wide Geofabrik PBF, runs `osrm-extract` → `osrm-partition` → `osrm-customize`, writes a `.osrm_ready` sentinel to a shared volume. First run takes several hours; subsequent restarts skip it. |
| `osrm-germany` | Runs `osrm-routed --algorithm mld` against the preprocessed data. No host port — only reachable by `api` on the internal Compose network. Waits on `osrm-init`'s successful completion. |
| `caddy` | Terminates TLS for `api.freipark.com` (see `Caddyfile`) and reverse-proxies to `api:8000`. Automatic HTTPS — no manual cert management. |
| `api` | The FastAPI backend. Waits on `osrm-germany`'s healthcheck before starting; exposes `OSRM_GERMANY_URL` so `backend/routers/regions.py` can reach it. |

**Region dispatch:** `backend/routers/regions.py` maps a destination
coordinate to an OSRM instance by bounding box. Today there is exactly one
`Region` (`germany`), but the pattern is designed to add more without
touching `route.py` — append a `Region(...)` entry and set its
`OSRM_<NAME>_URL` env var.

**Rate limiting:** `/route` is limited to 30 requests/minute per IP via
`slowapi`, protecting the self-hosted OSRM instance (which has no external
rate limiting of its own) from abuse.

**Operational note:** the OSRM preprocessing step (`osrm-init`) is heavy —
full Germany extraction, partitioning, and customization takes hours on
first run and produces a multi-GB dataset on the `osrm_data` volume. This
is a real infra cost (disk + one-time compute), even though it's not a
*per-call* cost — worth knowing before spinning up a fresh environment.

---

## Self-Hosted Supabase Migration (Proposed)

*(Proposed 2026-09-26 — not yet implemented. Nothing in this section
exists in `docker-compose.yml`, `backend/.env`, or `frontend/.env` yet;
this is the spec to build against, per `CLAUDE.md`'s spec-first rule.)*

### Why

Three concerns, all tied to real events rather than hypotheticals:

- **Free-tier auto-pause.** The managed Supabase project paused itself
  from inactivity during this project's own work session, breaking
  `pytest tests/test_db.py` and any live client until manually resumed
  from the dashboard. Unacceptable for an app with unpredictable usage
  gaps.
- **Cost at scale.** `CLAUDE.md`'s hard constraint — "No per-call API
  costs that scale with user growth" — is in direct tension with
  Supabase's usage-based billing components (bandwidth, MAU-based Auth
  pricing beyond the included allowance) once usage grows past free/Pro
  tier limits.
- **Vendor lock-in / control.** Keep the same DB engine, the same RLS
  model, the same client contract — but own the box it runs on, the same
  way this project already owns OSRM instead of paying a per-call routing
  API (§ Routing infra above).

### Why the existing OVH box, not new infrastructure

FreiPark already self-hosts OSRM there for the identical reason (zero
per-call cost). Resource headroom was checked before proposing this
(2026-09-26), not assumed:

| Resource | Total | In use | Free |
|---|---|---|---|
| CPU | 8 vCPUs | ~2% (OSRM mostly idle) | effectively all of it |
| RAM | 22GB | 5.3GB (OSRM ≈4.6GB is the bulk of it) | 17GB |
| Disk | 193GB | 16GB | 178GB |

A lean self-hosted Supabase stack (below) typically runs under 2GB RAM
combined and a few hundred MB of disk for the software itself — leaves
ample headroom alongside `osrm-germany`/`caddy`/`api` without resource
contention.

### What actually needs to run

Confirmed by grepping `frontend/src` and `backend` for `supabase.storage`,
`.channel(`, and `supabase.realtime` — **zero matches.** This app only
touches four pieces of the Supabase surface: Postgres+PostGIS (schema,
RLS), GoTrue (email+password and phone OTP auth), PostgREST
(`supabase.rpc()`/`.from()` calls from `useSpots.ts`/`useAuth.ts`), and
Kong as the API gateway that fronts both under `/rest/v1` and `/auth/v1`
— the routes `@supabase/supabase-js` expects at whatever `SUPABASE_URL`
points to.

| Service | Image | Role | Exposed externally? |
|---|---|---|---|
| `db` | `supabase/postgres` | Postgres 15 + PostGIS, same extension set as managed Supabase | No — internal Compose network only |
| `auth` | `supabase/gotrue` | Email+password, phone OTP (Twilio), JWT issuing | No — behind Kong |
| `rest` | `postgrest/postgrest` | Auto-generated REST API over Postgres; enforces RLS | No — behind Kong |
| `kong` | `kong` | API gateway: routes `/rest/v1/*` → `rest`, `/auth/v1/*` → `auth` | Yes — via Caddy |

**Deliberately excluded:** Storage and Realtime (unused, confirmed above
— not a schema-breaking addition later if that changes). Studio
(dashboard UI — use `psql` directly for admin work; if ever needed,
run it as a separate one-off compose file, never exposed publicly).
Analytics/Logflare/Vector (managed Supabase's logging stack — resource-
heavy, no current use case).

### Integration with the existing stack

Add these four services to the **existing** `docker-compose.yml` — same
file, same Docker network as `osrm-germany`/`caddy`/`api`, not a separate
compose project. Add one more Caddy route, mirroring the existing
`api.freipark.com` block:

```caddyfile
# Caddyfile — additive, alongside the existing api.freipark.com block
supabase.freipark.com {
    reverse_proxy kong:8000
}
```

`backend/.env` and `frontend/.env` then point at the new host instead of
`*.supabase.co` — same variable names, new values:

```
SUPABASE_URL=https://supabase.freipark.com
EXPO_PUBLIC_SUPABASE_URL=https://supabase.freipark.com
```

`@supabase/supabase-js` (frontend) and `psycopg2`/`asyncpg` (backend)
don't care whether `SUPABASE_URL`/`DATABASE_URL` point at Supabase's cloud
or a self-hosted Kong/Postgres instance — same REST/Auth contract, **zero
app code changes** in `useAuth.ts`, `useSpots.ts`, `src/lib/supabase.ts`,
`backend/db/connection.py`, or any RLS policy in `supabase/migrations/`.

### JWT keys

Self-hosted Supabase has no dashboard minting `anon`/`service_role` keys
for you. Instead, you own a single `JWT_SECRET` and mint both keys
yourself as JWTs signed with it (`role: anon` / `role: service_role`
claims — Supabase's self-hosting docs have the exact payload shape). The
resulting `EXPO_PUBLIC_SUPABASE_ANON_KEY` **still isn't a secret** — RLS
enforces access exactly as it does today — only `JWT_SECRET` itself and
the minted `service_role` key need `.env`-only, never-committed treatment
(same rule already in § Environment Variables below).

### Migration path (managed → self-hosted)

1. Stand up the self-hosted stack against an **empty** Postgres; apply
   every file in `supabase/migrations/` in order via `psql` — the same
   SQL files already in this repo, no rewrite needed.
2. `pg_dump --data-only` the managed project's `public` schema (`cities`,
   `parking_spots`) and `auth.users`/`auth.identities` (GoTrue is the same
   OSS software on both sides, so the dump is schema-compatible); restore
   into the new instance.
3. Re-run `backend/scripts/import_all.py` against the new instance as a
   sanity check rather than trusting the dump alone — cheap and idempotent
   (`ON CONFLICT (osm_id, osm_type) DO UPDATE`), catches any drift.
4. Point a **separate staging config** (not the live `frontend/.env`) at
   `supabase.freipark.com` and manually verify sign-in, sign-up, phone
   OTP, and spot loading before touching production env vars.
5. Cut over `backend/.env` and `frontend/.env`, redeploy.
6. Keep the managed Supabase project **paused** (not deleted) for a
   defined rollback window — paused projects don't bill, so this is a free
   safety net. See § Open Questions for how long.

### New operational responsibilities (the real cost of this move)

Self-hosting means this project now owns what Supabase managed before:

- **Backups.** No more automatic managed backups. Needs a `pg_dump` cron
  job writing somewhere other than the same disk — e.g. the same
  Cloudflare R2 bucket already used for tiles/glyphs (§ Cloudflare R2:
  PMTiles Setup), since R2 has no egress cost either way.
- **Version upgrades.** Postgres/GoTrue/PostgREST/Kong upgrades were
  previously silent and managed; now a deliberate `docker compose pull &&
  up -d` on a schedule, changelog read first.
- **Box-level security patching.** Already true today for this VPS (it
  already runs OSRM) — but the database now shares that same blast
  radius, raising the stakes of keeping the host patched.
- **Email/SMS provider config.** Brevo SMTP and Twilio, previously
  Supabase dashboard fields, become `auth` container env vars
  (`GOTRUE_SMTP_*`, `GOTRUE_SMS_TWILIO_*`) — same providers, same
  credentials, different config surface.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Resource contention with OSRM under load | Low (see headroom table above) | `docker stats` monitoring; OSRM already has a fixed, bounded footprint |
| Data loss or extended downtime during cutover | Medium if rushed | Staging validation first (§ Migration path step 4); managed project stays paused, not deleted, as rollback |
| GoTrue self-hosted config drifts from the managed project's current dashboard settings (email templates, redirect URLs, OTP expiry) | Medium | Diff every `GOTRUE_*` env var against the managed project's Auth dashboard before cutover, not after |
| Single VPS now runs routing **and** the database — one box, two critical dependencies | Medium, accepted for MVP scale | Out of scope to fix until real uptime requirements exist; documented here so it isn't forgotten later |

### Success Criteria

*(Unchecked — this is a proposal, not yet built.)*

- [ ] `db`, `auth`, `rest`, `kong` services added to `docker-compose.yml`, running healthy alongside `osrm-germany`/`caddy`/`api`
- [ ] Every file in `supabase/migrations/` applies cleanly to the new instance; `backend/tests/test_db.py`'s four tests pass against it
- [ ] `cities` + `parking_spots` data migrated and verified (`import_all.py` re-run as a sanity check, not just a trusted dump)
- [ ] `auth.users` migrated; existing accounts can still sign in post-cutover
- [ ] Phone OTP (Twilio) and email (Brevo) both re-verified end-to-end against the self-hosted `auth` service, not assumed to carry over
- [ ] Staging cutover validated (sign-in, sign-up, spot loading) before touching production `.env`
- [ ] Backup cron job in place **and test-restored at least once** before the managed Supabase project is deleted (not just paused)
- [ ] This file and `tasks/plan.md` updated to reflect the cutover once live, per this project's own reconciliation practice

### Open Questions

- How long should the managed Supabase project stay paused as a rollback
  safety net before deletion? Proposed: 2 weeks post-cutover, revisit
  based on how cutover actually goes.
- Does Studio ever get run for admin convenience — and if so, how is it
  kept off the public internet (SSH tunnel vs. a Caddy basic-auth gate)?
  Not needed for MVP; only matters if hand-editing data becomes routine.
- Backup restore testing cadence — an untested backup isn't a verified
  backup. Needs an answer before this is considered production-ready,
  not left as a someday task.

---

## Environment Variables

### `backend/.env.example`

```bash
# Supabase — get these from app.supabase.com → Settings → API
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret-key>   # bypasses RLS — backend only, never expose

# Supabase connection pooler (Transaction mode) — use this, not the direct connection
# Format: postgresql://postgres.<project-ref>:<db-password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

# App
ENVIRONMENT=development   # development | production
LOG_LEVEL=info
```

> **Corrected:** the original draft of this section showed a direct
> (non-pooled) `DATABASE_URL`. The actual `.env.example` uses Supabase's
> Transaction-mode connection **pooler** instead — Supabase's free tier
> caps direct connections at 10, and the pooler avoids exhausting that
> limit under concurrent import/API load.
>
> `OSRM_GERMANY_URL` (read by `backend/routers/regions.py`) is **not** a
> backend `.env` variable — it's set by `docker-compose.yml`'s
> `environment:` block, defaulting to `http://osrm-germany:5000` (the
> in-network Compose service name). Only override it if running the API
> outside Docker Compose.

### `frontend/.env.example`

```bash
# Supabase (anon key is safe to expose; RLS enforces access)
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Map tiles (per-city PMTiles URL)
EXPO_PUBLIC_PMTILES_URL=https://pub-<hash>.r2.dev/berlin.pmtiles

# FastAPI backend (routing proxy — see § Routing infra)
EXPO_PUBLIC_API_URL=https://api.freipark.com
```

> `EXPO_PUBLIC_API_URL` was added to `useRoute.ts` when the routing feature
> shipped, but `frontend/.env.example` was never updated to match — a
> `CLAUDE.md` rule violation this reconciliation fixes (see the
> `frontend/.env.example` diff and `SPEC-map.md`'s tech stack table).

**Never commit:** Actual `.env` files, `SERVICE_ROLE_KEY`, `DATABASE_URL` with credentials.

---

## Code Style

Supabase client singleton (frontend pattern used across all modules):

```typescript
// src/lib/supabase.ts — actual implementation, not the originally-planned generated-types version
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

> **Corrected:** the original draft called for `supabase gen types
> typescript` generated types (`createClient<Database>(...)`). That was
> never implemented — `SpotRow` and friends are hand-written in
> `src/lib/types.ts` instead. Worth revisiting once the schema stabilizes
> further, but not a blocker for anything today.
>
> Note the `auth:` config block (`AsyncStorage` session persistence,
> auto-refresh) is already wired even though no auth UI exists — this is
> the one piece of groundwork already laid for the future `auth` module.

Backend request/response models (Pydantic, inline in each router — see
§ Project Structure note on `backend/models/` not existing as a separate
directory):

```python
# backend/routers/route.py — actual pattern in use
from pydantic import BaseModel, Field, model_validator

class RouteParams(BaseModel):
    from_lon: float = Field(..., ge=-180, le=180)
    from_lat: float = Field(..., ge=-90, le=90)
    to_lon:   float = Field(..., ge=-180, le=180)
    to_lat:   float = Field(..., ge=-90, le=90)

    @model_validator(mode="after")
    def destination_in_region(self) -> "RouteParams":
        ...  # validates the destination falls inside a known Region

class RouteResponse(BaseModel):
    geometry: dict
    distance_m: float
    duration_s: float
    region: str
```

**Conventions:**
- No `any` types in TypeScript; no untyped dicts in Python (strict Pydantic)
- All SQL in `supabase/migrations/` as numbered files (`001_`, `002_`, ...); no ad-hoc schema changes
- Migration files are append-only; never edit a migration that has been pushed to the project

---

## Testing Strategy

**Framework:** pytest (backend), Jest + React Native Testing Library (frontend)

**Infra-specific tests** (`backend/tests/test_db.py` — actual implementation
uses synchronous `psycopg2`, not the `asyncpg`/`await db.fetchval(...)` style
originally sketched here; the RLS test also checks policy metadata directly
rather than attempting a live anon insert, which is more robust against
network/auth setup differences):

```python
def test_postgis_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT PostGIS_Version()")
        version = cur.fetchone()[0]
    assert version, "PostGIS_Version() returned empty — extension not installed"


def test_berlin_seed_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT slug, name, country_code FROM cities WHERE slug = 'berlin'")
        row = cur.fetchone()
    assert row == ("berlin", "Berlin", "DE")


def test_spatial_index_used(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            EXPLAIN (FORMAT TEXT)
            SELECT id FROM parking_spots
            ORDER BY location <-> ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326)
            LIMIT 10
        """)
        plan = "\n".join(row[0] for row in cur.fetchall())
    assert "Index Scan" in plan, f"Expected KNN index scan, got:\n{plan}"


def test_rls_blocks_anon_insert(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT relrowsecurity FROM pg_class
            WHERE oid = 'public.parking_spots'::regclass
        """)
        assert cur.fetchone()[0] is True, "RLS not enabled on parking_spots"

        cur.execute("""
            SELECT count(*) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'parking_spots'
              AND cmd IN ('INSERT', 'ALL')
              AND (roles @> ARRAY['anon'::name] OR roles @> ARRAY['public'::name])
        """)
        assert cur.fetchone()[0] == 0, "Unexpected INSERT/ALL policy grants anon write access"
```

**Infra tests run against the local Supabase dev instance** (`supabase start`). No database mocking — a mocked schema would not catch RLS policy errors or missing indexes.

**Gap:** there are no tests covering the multi-city seed
(`004_add_german_cities.sql`) or the routing infra (`route.py`,
`regions.py`) — only the original Berlin-scoped checks exist. Worth adding
if routing correctness becomes a source of bugs.

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
- Adding more cities beyond the 30+ already seeded (§ Seeded Cities) — the
  original "ask first" gate here was about the *first* expansion past
  Berlin, which has already happened; further growth should still be a
  deliberate call (import runtime, R2/tile coverage, OSRM dataset size all
  scale with city count)

**Never:**
- Commit `.env` files or any file containing actual secrets
- Use `SUPABASE_SERVICE_ROLE_KEY` on the frontend (bypasses all RLS)
- Drop or rename columns in a migration (add-only until a formal deprecation cycle)
- Query the Overpass API in production (rate-limited; use Geofabrik PBF for bulk import)
- Hardcode `'berlin'` as a city slug inside application code (always read from `cities` table or config)

---

## Verifying Supabase JWTs (Future)

*(Added 2026-08-24, in response to a question about migrating the FastAPI
backend from a shared-secret JWT check to JWKS-based verification.)*

**There is nothing to migrate.** Grepped the entire backend — `backend/`
has zero JWT-verification code today, no `jwt`/`jwks`/token-decode logic
anywhere, and no JWT library in `requirements.txt`. Both existing routes
(`/health/db`, `/route`) are intentionally public; `/route` rate-limits by
IP, not by user identity. So rotating the Supabase project's JWT signing
keys from a shared secret to asymmetric (RS256/ES256) is a pure dashboard
action with **zero backend impact**, because nothing here currently cares
what algorithm signed the token.

**Caveat worth having up front:** most Supabase-backed features — including
Phase 2's `spot_reports` below — don't need backend JWT verification at
all. The established pattern in this codebase (`useSpots.ts` calling
`supabase.rpc()` directly) is for the *client* to call Supabase directly
with the user's session token, and let Postgres RLS policies (checking
`auth.uid()`) enforce who can write what — Supabase's own infrastructure
verifies the JWT internally for that path, not our code. Backend JWT
verification only becomes necessary if a **FastAPI route** needs to know
the caller's identity for logic RLS can't express (e.g., server-side
per-user rate limiting, a business rule spanning multiple tables). Don't
build the snippet below speculatively — it has no caller yet, which means
no test coverage and no way to verify it actually works. Build it in the
same change that adds the first route that needs it.

**When that day comes**, verify against Supabase's JWKS endpoint rather
than a static secret — this is what asymmetric signing keys enable, and
it's the right way to do it from day one rather than a later migration:

```python
# backend/auth.py (does not exist yet — for when it's needed)
import time
import httpx
from fastapi import HTTPException, Header
from jose import jwt  # add python-jose[cryptography] to requirements.txt

JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_jwks_cache: dict | None = None
_jwks_cached_at: float = 0
JWKS_CACHE_TTL_S = 3600  # Supabase rotates keys infrequently; no need to refetch every request

async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_cached_at
    if _jwks_cache is None or time.time() - _jwks_cached_at > JWKS_CACHE_TTL_S:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(JWKS_URL)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            _jwks_cached_at = time.time()
    return _jwks_cache

async def get_current_user_id(authorization: str = Header(...)) -> str:
    token = authorization.removeprefix("Bearer ").strip()
    jwks = await _get_jwks()
    try:
        claims = jwt.decode(token, jwks, algorithms=["RS256", "ES256"], audience="authenticated")
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    return claims["sub"]  # Supabase's auth.users.id
```

Module-level `_jwks_cache` is fine for a single-process FastAPI deployment
(this project's current Docker Compose setup — one `api` container); if
that ever changes to multiple worker processes without shared state,
switch to a proper shared cache (Redis, or a short-TTL in-memory cache per
worker is still fine since JWKS rotation is rare).

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

- [x] Supabase project exists; PostGIS extension enabled; `cities` and `parking_spots` tables created with all indexes and RLS policies
- [x] `supabase/migrations/001_initial_schema.sql` committed and applied via `supabase db push`
- [x] Berlin seed row present in `cities` table (`slug = 'berlin'`) — and 30+ more cities via `004_add_german_cities.sql` (§ Seeded Cities)
- [x] RLS tests pass: anonymous client can SELECT; INSERT is denied; service role bypasses RLS
- [x] Spatial index test passes: nearest-spot query uses `Index Scan`, not `Seq Scan`
- [x] Cloudflare R2 bucket `freipark-tiles` created; `berlin.pmtiles` uploaded; CORS configured; public URL resolves
- [x] `backend/.env.example` and `frontend/.env.example` committed with all required variables documented (this reconciliation closed a gap — `EXPO_PUBLIC_API_URL` was missing until now)
- [x] OSM import script runs end-to-end: `python import_osm.py --city berlin` downloads PBF, filters parking features, inserts rows via upsert-by-`osm_id`, logs row count — plus `import_all.py` for every seeded city
- [x] At least one spot record queryable via `GET /health/db` returning spot count > 0 — **shape evolved**: the endpoint now returns `{status, total_spots, cities: [{city, spot_count}, ...]}` (aggregated across all seeded cities), not the single `{status, spot_count, city}` shape originally sketched in `tasks/plan.md` T6a
- [x] No secrets in git history — the original literal check (`git log -p | grep -i 'supabase\|key\|password'`) is too broad to pass on this repo (it matches env var *names* and this doc's own prose); re-verified 2026-08-23 with a pattern targeting actual credential values (`SUPABASE_SERVICE_ROLE_KEY=<real-looking-value>`, live `DATABASE_URL` with a password) — no matches

---

## Open Questions

None blocking. Resolved before this spec was written:

- ~~Map tile provider~~ → MapLibre + Protomaps PMTiles on Cloudflare R2 (zero per-request cost)
- ~~Auth provider~~ → Supabase Auth, email+password
- ~~Real-time availability~~ → Deferred to Phase 2 (no free data source for street vacancy exists)
- ~~Booking/payments~~ → Out of scope; EasyPark/ParkNow handoff via deep link in spot-finder module
- ~~City hardcoded to Berlin~~ → `cities` table is the first-class concept; import script parameterized by `--city <slug>`
