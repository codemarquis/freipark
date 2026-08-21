# Implementation Plan: infra module

**Spec:** [SPEC-infra.md](../SPEC-infra.md)  
**Module:** `infra`  
**Build position:** First — all other modules depend on this.

---

## Dependency Graph

```
[T1] Supabase project + schema ──┐
[T2] Cloudflare R2 bucket ───────┤
                                  ├──▶ [T3] Env files ──▶ [T4] DB connection ──▶ [T5] Import script ──▶ [T6] Health endpoint ──▶ [T7] Tests
```

T1 and T2 are independent manual setup steps that can be done in parallel. Everything else is sequential.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `osmium-tool` not installed | High | `brew install osmium-tool`; add to setup notes |
| Geofabrik PBF download (~400MB) slow/flaky | Medium | Cache in `backend/scripts/data/`; add to `.gitignore` |
| Supabase free tier connection limit (10 direct) | Low | Use connection pooler URL for the import script |
| PostGIS extension not enabled by default on new project | Medium | `CREATE EXTENSION IF NOT EXISTS postgis` is in the migration — benign if already enabled |
| R2 CORS misconfiguration breaks range requests | Medium | Test with `curl -H "Range: bytes=0-1023"` before wiring to MapLibre |

---

## Tasks

### T1 — Supabase project + schema

*Manual setup. Do before any code.*

- [ ] **T1a: Create Supabase project**
  - Acceptance: Project exists at `app.supabase.com`; PostGIS enabled; project ref, URL, anon key, and service role key are in hand
  - Verify: `supabase projects list` shows the project
  - Files: none

- [ ] **T1b: Configure supabase CLI**
  - Acceptance: `supabase/config.toml` has the correct `project_id`; `supabase link --project-ref <ref>` succeeds
  - Verify: `supabase status` returns the linked project
  - Files: `supabase/config.toml`

- [ ] **T1c: Apply initial migration**
  - Acceptance: `supabase db push` runs without errors; `cities` and `parking_spots` tables exist; Berlin seed row present (`SELECT slug FROM cities` returns `'berlin'`); all indexes created; RLS enabled on `parking_spots`
  - Verify: `supabase db push` exits 0; run verification queries in Supabase SQL editor
  - Files: `supabase/migrations/001_initial_schema.sql` (already written — no edits needed)

---

### T2 — Cloudflare R2 bucket

*Manual setup. Can run in parallel with T1.*

- [ ] **T2a: Create R2 bucket and configure public access**
  - Acceptance: Bucket `freipark-tiles` exists; public read enabled; CORS rule allows `GET` from all origins
  - Verify: `curl -I https://pub-<hash>.r2.dev/` returns 200 or 403 (not a network error)
  - Files: none (dashboard config)

- [ ] **T2b: Generate and upload berlin.pmtiles**
  - Acceptance: `berlin.pmtiles` object exists in bucket; a range request returns partial content
  - Verify: `curl -H "Range: bytes=0-4095" https://pub-<hash>.r2.dev/berlin.pmtiles` returns HTTP 206 with ~4KB body
  - Files: none (object upload)
  - Note: Download from Protomaps daily builds or convert via `pmtiles convert berlin-latest.osm.pbf berlin.pmtiles`

---

### T3 — Environment files

*Requires T1 and T2 keys in hand.*

- [ ] **T3a: Create backend env files**
  - Acceptance: `backend/.env.example` committed with all variable names and placeholder values; real `backend/.env` created locally (not committed); `.gitignore` excludes `.env` files
  - Verify: `grep "SUPABASE_URL" backend/.env.example` returns the line; `git status` does not list `backend/.env`
  - Files: `backend/.env.example`, `backend/.env` (local only), `.gitignore`

- [ ] **T3b: Create frontend env files**
  - Acceptance: `frontend/.env.example` committed; real `frontend/.env` created locally; `EXPO_PUBLIC_PMTILES_URL` points to the live R2 URL from T2b
  - Verify: `grep "EXPO_PUBLIC_PMTILES_URL" frontend/.env` returns the R2 URL
  - Files: `frontend/.env.example`, `frontend/.env` (local only)

---

### T4 — Backend DB connection

- [ ] **T4a: Write requirements.txt**
  - Acceptance: Includes `fastapi`, `uvicorn`, `asyncpg`, `psycopg2-binary`, `pydantic`, `python-dotenv`; install succeeds cleanly
  - Verify: `pip install -r backend/requirements.txt` exits 0
  - Files: `backend/requirements.txt`

- [ ] **T4b: Implement asyncpg connection pool**
  - Acceptance: `backend/db/connection.py` exports a pool that reads `DATABASE_URL` from env; pool opens on app startup and closes on shutdown; `fastapi dev backend/main.py` starts without error
  - Verify: Server starts; no connection errors in logs
  - Files: `backend/db/connection.py`, `backend/main.py`

---

### T5 — OSM import script

- [ ] **T5a: Write Geofabrik download helper**
  - Acceptance: `bash backend/scripts/download_osm.sh berlin` fetches `geofabrik_url` from the `cities` row, downloads to `backend/scripts/data/berlin.osm.pbf`; re-running skips the download if file exists
  - Verify: First run produces `data/berlin.osm.pbf` (~400MB); second run prints "already cached" and exits immediately
  - Files: `backend/scripts/download_osm.sh`, add `backend/scripts/data/` to `.gitignore`

- [ ] **T5b: Write import_osm.py**
  - Acceptance: `python backend/scripts/import_osm.py --city berlin` (a) fetches the `cities` row for slug `berlin`, (b) invokes `osmium tags-filter` to extract parking features, (c) upserts rows into `parking_spots` via `ON CONFLICT (osm_id, osm_type) DO UPDATE`, (d) logs inserted/updated/unchanged counts; script is idempotent
  - Verify: First run logs `inserted: N, updated: 0`; second run logs `inserted: 0, updated: 0, unchanged: N`
  - Files: `backend/scripts/import_osm.py`
  - Prereq: `osmium-tool` installed (`brew install osmium-tool`)

---

### T6 — Health endpoint

- [ ] **T6a: Implement GET /health/db**
  - Acceptance: Returns `{"status": "ok", "spot_count": N, "city": "berlin"}` where N > 0 after the import; returns HTTP 503 `{"status": "error"}` if DB is unreachable
  - Verify: `curl http://localhost:8000/health/db` after T5b returns `spot_count > 0`
  - Files: `backend/routers/health.py`, `backend/main.py`

---

### T7 — Infra tests

- [ ] **T7a: Write test_db.py**
  - Acceptance: All four tests from `SPEC-infra.md § Testing Strategy` pass — PostGIS enabled, Berlin seed row present, spatial KNN uses Index Scan, RLS blocks anon INSERT
  - Verify: `cd backend && pytest tests/test_db.py -v` exits 0 with 4 passing
  - Files: `backend/tests/test_db.py`, `backend/tests/conftest.py`
  - Note: Tests run against local Supabase dev instance (`supabase start`), not production

---

## Completion Checklist

All nine success criteria from `SPEC-infra.md`:

- [ ] T1c — schema applied; `cities` and `parking_spots` tables, all indexes, RLS confirmed
- [ ] T1c — Berlin seed row present (`slug = 'berlin'`)
- [ ] T7a — RLS: anon SELECT succeeds; anon INSERT denied
- [ ] T7a — spatial index: KNN query plan shows Index Scan, not Seq Scan
- [ ] T2b — `freipark-tiles` bucket live; `curl -H "Range: bytes=0-4095"` returns HTTP 206
- [ ] T3  — both `.env.example` files committed
- [ ] T5b — `python import_osm.py --city berlin` exits 0; row count logged
- [ ] T6a — `GET /health/db` returns `spot_count > 0`
- [ ] Final — `git log -p | grep -i 'supabase\|key\|password'` returns nothing

---

---

# Implementation Plan: map module

**Spec:** [SPEC-map.md](../SPEC-map.md)
**Module:** `map`
**Build position:** Second — depends on infra (DB live, spots imported, R2 serving tiles).

---

## Dependency Graph

```
[M1] DB migration (002_spots_in_bbox) ─────────────────────────┐
                                                                 │
[M2] Expo bootstrap + deps ──→ [M3] Supabase client + types ───┤
                            └──→ [M4] MapLibre base map ────────┤
                                                                 ├──→ [M6] SpotLayer ──→ [M7] SpotDetailSheet ──→ [M8] Tests
                M1 + M3 ──────→ [M5] useSpots hook + geo ───────┘
```

M1 and M2 are independent — run in parallel.
Critical path: **M2 → M4** (MapLibre native build is the highest-risk step).
M3 and M4 can start in parallel once M2 is done.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `@maplibre/maplibre-react-native` requires native build — Expo Go not supported | **High** | Install `expo-dev-client`; build with `npx expo run:ios` (needs Xcode). Document as a hard prerequisite. |
| PMTiles `pmtiles://` protocol handler API differs between MapLibre JS and RN | Medium | Use `MapLibreGL.addProtocol('pmtiles', ...)` with the `pmtiles` npm package + `fetch` (works in RN); test tile load early in M4 |
| `@gorhom/bottom-sheet` peer deps (`react-native-reanimated`, `react-native-gesture-handler`) need native build | Medium | Both included in the M2 install batch; covered by the same dev-client build |
| Supabase anon role missing EXECUTE grant on `spots_in_bbox` | Medium | Migration includes `GRANT EXECUTE ... TO anon, authenticated` — verify with a JS client call before wiring M5 |
| 2000-spot GeoJSON payload ~200 KB — fine on WiFi, slow on 3G | Low | Acceptable for MVP; note as Phase 2 optimisation (tile-backed spot layer) |

---

## Tasks

### M1 — DB migration: `spots_in_bbox` RPC

- [ ] **M1: Write and apply 002_spots_in_bbox.sql**
  - Acceptance: `supabase db push` succeeds; anon JS client can call
    `supabase.rpc('spots_in_bbox', {min_lon:13.3, min_lat:52.4, max_lon:13.6, max_lat:52.6})`
    and receive rows (not a 403 or empty error)
  - Verify: Supabase SQL editor: `SELECT * FROM spots_in_bbox(13.3,52.4,13.6,52.6)` returns rows;
    `GRANT` visible in `information_schema.role_routine_grants`
  - Files: `supabase/migrations/002_spots_in_bbox.sql`

---

### M2 — Expo bootstrap + dependencies

- [ ] **M2: Bootstrap Expo project and install all native deps**
  - Acceptance: `frontend/` contains a valid Expo SDK 53 project with TypeScript;
    `package.json` lists all required deps; `npx expo start` runs Metro without
    dependency errors; `app.json` has bundle ID placeholders
  - Verify: `cd frontend && npx expo start --non-interactive` prints "Starting Metro"
  - Files: `frontend/package.json`, `frontend/app.json`, `frontend/tsconfig.json`,
    `frontend/app/_layout.tsx`, `frontend/app/index.tsx`, `frontend/.env`
  - Deps to install:
    ```
    npx expo install expo-dev-client
    npx expo install @maplibre/maplibre-react-native
    npx expo install @supabase/supabase-js
    npx expo install @gorhom/bottom-sheet
    npx expo install react-native-reanimated react-native-gesture-handler
    npm install pmtiles
    npx expo install expo-linking
    ```
  - Note: `expo-dev-client` is required — MapLibre is a native module.
    Expo Go will not run the finished app. First device test requires
    `npx expo run:ios` (Xcode) or `npx expo run:android` (Android Studio).

---

### M3 — Supabase client + types

- [ ] **M3: Implement `src/lib/supabase.ts` and `src/lib/types.ts`**
  - Acceptance: `createClient` singleton exported using `EXPO_PUBLIC_*` env vars;
    `SpotRow` interface matches `spots_in_bbox` return columns
    `(id, spot_type, access, operator, capacity, lon, lat)`;
    `npx tsc --noEmit` passes with zero errors
  - Verify: `npx tsc --noEmit` exits 0
  - Files: `frontend/src/lib/supabase.ts`, `frontend/src/lib/types.ts`

---

### M4 — MapLibre base map + PMTiles protocol

*Hardest task. Tackle before M5/M6 — validates the native build works.*

- [ ] **M4: Render Berlin base map from R2 PMTiles**
  - Acceptance: `npx expo run:ios` produces a dev-client build; map renders
    Berlin streets centred at `{lon:13.405, lat:52.52}` zoom 13; network logs
    show `206 Partial Content` from the R2 URL (direct range requests, no proxy)
  - Verify: iOS Simulator shows Berlin map; network inspector confirms `206`
    from `pub-*.r2.dev/berlin.pmtiles`
  - Files: `frontend/src/features/map/MapScreen.tsx`, `frontend/app/index.tsx`
  - Key implementation:
    ```ts
    import { Protocol } from 'pmtiles';
    import MapLibreGL from '@maplibre/maplibre-react-native';
    const p = new Protocol();
    MapLibreGL.addProtocol('pmtiles', p.tile.bind(p));
    // style source URL: 'pmtiles://' + process.env.EXPO_PUBLIC_PMTILES_URL
    ```

---

### M5 — `useSpots` hook + geo helpers

- [ ] **M5: Implement viewport-bounded spot query**
  - Acceptance: `useSpots(bounds)` calls `supabase.rpc('spots_in_bbox', ...)`
    when bounds change (debounced 300 ms); returns a GeoJSON `FeatureCollection`
    with `Point` features; each feature's `properties` carries
    `{id, spot_type, access, operator, capacity}`
  - Verify: `npx jest useSpots.test.ts` passes; manual: hook logs rows on
    simulator map idle
  - Files: `frontend/src/features/map/useSpots.ts`, `frontend/src/lib/geo.ts`

---

### M6 — SpotLayer

- [ ] **M6: GeoJSON source + cluster + circle layers**
  - Acceptance: Coloured clusters visible over Berlin at zoom 13; zooming in
    reveals individual dots coloured by `access`; tap cluster → camera zooms +2;
    tap spot → `onSpotPress` fires with the `SpotRow`
  - Verify: Simulator — zoom 10 shows clusters with counts; zoom 15 shows
    individual coloured dots; both tap targets respond
  - Files: `frontend/src/features/map/SpotLayer.tsx`
  - Colour map: `free=#22c55e, paid=#3b82f6, permit=#f59e0b, private=#ef4444, unknown=#94a3b8`

---

### M7 — SpotDetailSheet + PaymentLinks

- [ ] **M7: Bottom sheet with spot info and payment CTAs**
  - Acceptance: Tapping a spot opens `@gorhom/bottom-sheet` at 50% snap;
    sheet shows type / access / operator / capacity; `access='paid'` shows
    "Pay via EasyPark" and "Pay via ParkNow" buttons calling `Linking.openURL`
    with correct platform store URL; free/permit/private spots show no payment
    buttons; sheet closes on backdrop tap or swipe down
  - Verify: `npx jest SpotDetailSheet.test.tsx` passes; manual simulator test
    confirms both paid and free cases
  - Files: `frontend/src/features/map/SpotDetailSheet.tsx`,
    `frontend/src/features/payments/PaymentLinks.tsx`

---

### M8 — Tests + coverage

- [ ] **M8: Unit tests, ≥ 80% coverage on lib + hook**
  - Acceptance: `npx jest --coverage` exits 0; statements/branches ≥ 80% on
    `src/lib/` and `useSpots.ts`; all three test files pass
  - Verify: Coverage report in terminal output
  - Files: `frontend/__tests__/geo.test.ts`,
    `frontend/__tests__/useSpots.test.ts`,
    `frontend/__tests__/SpotDetailSheet.test.tsx`

---

## Completion Checklist

All nine success criteria from `SPEC-map.md`:

- [ ] M2 + M4 — `npx expo start` QR scannable; map loads within 3 s on WiFi
- [ ] M4 — R2 `berlin.pmtiles` serves `206 Partial Content` (no tile server)
- [ ] M5 + M6 — spot clusters visible after pan/zoom in Berlin
- [ ] M6 — tap cluster zooms in; tap spot opens bottom sheet
- [ ] M7 — bottom sheet shows correct type / access / operator / capacity
- [ ] M7 — paid spots show EasyPark + ParkNow buttons; free spots do not
- [ ] M7 — payment button opens correct App Store / Play Store page (manual)
- [ ] M8 — `npx jest --coverage` passes, ≥ 80% on `src/lib/` + `useSpots.ts`
- [ ] M1–M7 — no per-request API cost introduced
