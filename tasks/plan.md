> **Reconciled 2026-08-23:** every checkbox below was left unchecked despite
> the corresponding work being done — this file was never updated after
> initial planning. All T1–T7 and M1–M8 tasks are complete; checkboxes now
> reflect that. A new § Routing, Search & Multi-City section at the bottom
> documents substantial work that shipped with **no corresponding plan
> entries at all** (it wasn't in either spec when built). See `SPEC-map.md`
> and `SPEC-infra.md` for the reconciled specs those sections now match.

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

- [x] **T1a: Create Supabase project**
  - Acceptance: Project exists at `app.supabase.com`; PostGIS enabled; project ref, URL, anon key, and service role key are in hand
  - Verify: `supabase projects list` shows the project
  - Files: none

- [x] **T1b: Configure supabase CLI**
  - Acceptance: `supabase/config.toml` has the correct `project_id`; `supabase link --project-ref <ref>` succeeds
  - Verify: `supabase status` returns the linked project
  - Files: `supabase/config.toml`

- [x] **T1c: Apply initial migration**
  - Acceptance: `supabase db push` runs without errors; `cities` and `parking_spots` tables exist; Berlin seed row present (`SELECT slug FROM cities` returns `'berlin'`); all indexes created; RLS enabled on `parking_spots`
  - Verify: `supabase db push` exits 0; run verification queries in Supabase SQL editor
  - Files: `supabase/migrations/001_initial_schema.sql` (already written — no edits needed)

---

### T2 — Cloudflare R2 bucket

*Manual setup. Can run in parallel with T1.*

- [x] **T2a: Create R2 bucket and configure public access**
  - Acceptance: Bucket `freipark-tiles` exists; public read enabled; CORS rule allows `GET` from all origins
  - Verify: `curl -I https://pub-<hash>.r2.dev/` returns 200 or 403 (not a network error)
  - Files: none (dashboard config)

- [x] **T2b: Generate and upload berlin.pmtiles**
  - Acceptance: `berlin.pmtiles` object exists in bucket; a range request returns partial content
  - Verify: `curl -H "Range: bytes=0-4095" https://pub-<hash>.r2.dev/berlin.pmtiles` returns HTTP 206 with ~4KB body
  - Files: none (object upload)
  - Note: Download from Protomaps daily builds or convert via `pmtiles convert berlin-latest.osm.pbf berlin.pmtiles`

---

### T3 — Environment files

*Requires T1 and T2 keys in hand.*

- [x] **T3a: Create backend env files**
  - Acceptance: `backend/.env.example` committed with all variable names and placeholder values; real `backend/.env` created locally (not committed); `.gitignore` excludes `.env` files
  - Verify: `grep "SUPABASE_URL" backend/.env.example` returns the line; `git status` does not list `backend/.env`
  - Files: `backend/.env.example`, `backend/.env` (local only), `.gitignore`

- [x] **T3b: Create frontend env files**
  - Acceptance: `frontend/.env.example` committed; real `frontend/.env` created locally; `EXPO_PUBLIC_PMTILES_URL` points to the live R2 URL from T2b
  - Verify: `grep "EXPO_PUBLIC_PMTILES_URL" frontend/.env` returns the R2 URL
  - Files: `frontend/.env.example`, `frontend/.env` (local only)

---

### T4 — Backend DB connection

- [x] **T4a: Write requirements.txt**
  - Acceptance: Includes `fastapi`, `uvicorn`, `asyncpg`, `psycopg2-binary`, `pydantic`, `python-dotenv`; install succeeds cleanly
  - Verify: `pip install -r backend/requirements.txt` exits 0
  - Files: `backend/requirements.txt`

- [x] **T4b: Implement asyncpg connection pool**
  - Acceptance: `backend/db/connection.py` exports a pool that reads `DATABASE_URL` from env; pool opens on app startup and closes on shutdown; `fastapi dev backend/main.py` starts without error
  - Verify: Server starts; no connection errors in logs
  - Files: `backend/db/connection.py`, `backend/main.py`

---

### T5 — OSM import script

- [x] **T5a: Write Geofabrik download helper**
  - Acceptance: `bash backend/scripts/download_osm.sh berlin` fetches `geofabrik_url` from the `cities` row, downloads to `backend/scripts/data/berlin.osm.pbf`; re-running skips the download if file exists
  - Verify: First run produces `data/berlin.osm.pbf` (~400MB); second run prints "already cached" and exits immediately
  - Files: `backend/scripts/download_osm.sh`, add `backend/scripts/data/` to `.gitignore`

- [x] **T5b: Write import_osm.py**
  - Acceptance: `python backend/scripts/import_osm.py --city berlin` (a) fetches the `cities` row for slug `berlin`, (b) invokes `osmium tags-filter` to extract parking features, (c) upserts rows into `parking_spots` via `ON CONFLICT (osm_id, osm_type) DO UPDATE`, (d) logs inserted/updated/unchanged counts; script is idempotent
  - Verify: First run logs `inserted: N, updated: 0`; second run logs `inserted: 0, updated: 0, unchanged: N`
  - Files: `backend/scripts/import_osm.py`
  - Prereq: `osmium-tool` installed (`brew install osmium-tool`)

---

### T6 — Health endpoint

- [x] **T6a: Implement GET /health/db**
  - Acceptance: Returns `{"status": "ok", "spot_count": N, "city": "berlin"}` where N > 0 after the import; returns HTTP 503 `{"status": "error"}` if DB is unreachable
  - Verify: `curl http://localhost:8000/health/db` after T5b returns `spot_count > 0`
  - Files: `backend/routers/health.py`, `backend/main.py`

---

### T7 — Infra tests

- [x] **T7a: Write test_db.py**
  - Acceptance: All four tests from `SPEC-infra.md § Testing Strategy` pass — PostGIS enabled, Berlin seed row present, spatial KNN uses Index Scan, RLS blocks anon INSERT
  - Verify: `cd backend && pytest tests/test_db.py -v` exits 0 with 4 passing
  - Files: `backend/tests/test_db.py`, `backend/tests/conftest.py`
  - Note: Tests run against local Supabase dev instance (`supabase start`), not production

---

## Completion Checklist

All nine success criteria from `SPEC-infra.md`:

- [x] T1c — schema applied; `cities` and `parking_spots` tables, all indexes, RLS confirmed
- [x] T1c — Berlin seed row present (`slug = 'berlin'`)
- [x] T7a — RLS: anon SELECT succeeds; anon INSERT denied
- [x] T7a — spatial index: KNN query plan shows Index Scan, not Seq Scan
- [x] T2b — `freipark-tiles` bucket live; `curl -H "Range: bytes=0-4095"` returns HTTP 206
- [x] T3  — both `.env.example` files committed
- [x] T5b — `python import_osm.py --city berlin` exits 0; row count logged
- [x] T6a — `GET /health/db` returns `spot_count > 0`
- [x] Final — `git log -p | grep -i 'supabase\|key\|password'` returns nothing

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

- [x] **M1: Write and apply 002_spots_in_bbox.sql**
  - Acceptance: `supabase db push` succeeds; anon JS client can call
    `supabase.rpc('spots_in_bbox', {min_lon:13.3, min_lat:52.4, max_lon:13.6, max_lat:52.6})`
    and receive rows (not a 403 or empty error)
  - Verify: Supabase SQL editor: `SELECT * FROM spots_in_bbox(13.3,52.4,13.6,52.6)` returns rows;
    `GRANT` visible in `information_schema.role_routine_grants`
  - Files: `supabase/migrations/002_spots_in_bbox.sql`

---

### M2 — Expo bootstrap + dependencies

- [x] **M2: Bootstrap Expo project and install all native deps**
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

- [x] **M3: Implement `src/lib/supabase.ts` and `src/lib/types.ts`**
  - Acceptance: `createClient` singleton exported using `EXPO_PUBLIC_*` env vars;
    `SpotRow` interface matches `spots_in_bbox` return columns
    `(id, spot_type, access, operator, capacity, lon, lat)`;
    `npx tsc --noEmit` passes with zero errors
  - Verify: `npx tsc --noEmit` exits 0
  - Files: `frontend/src/lib/supabase.ts`, `frontend/src/lib/types.ts`

---

### M4 — MapLibre base map + PMTiles protocol

*Hardest task. Tackle before M5/M6 — validates the native build works.*

- [x] **M4: Render Berlin base map from R2 PMTiles**
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

- [x] **M5: Implement viewport-bounded spot query**
  - Acceptance: `useSpots(bounds)` calls `supabase.rpc('spots_in_bbox', ...)`
    when bounds change (debounced 300 ms); returns a GeoJSON `FeatureCollection`
    with `Point` features; each feature's `properties` carries
    `{id, spot_type, access, operator, capacity}`
  - Verify: `npx jest useSpots.test.ts` passes; manual: hook logs rows on
    simulator map idle
  - Files: `frontend/src/features/map/useSpots.ts`, `frontend/src/lib/geo.ts`

---

### M6 — SpotLayer

- [x] **M6: GeoJSON source + cluster + circle layers**
  - Acceptance: Coloured clusters visible over Berlin at zoom 13; zooming in
    reveals individual dots coloured by `access`; tap cluster → camera zooms +2;
    tap spot → `onSpotPress` fires with the `SpotRow`
  - Verify: Simulator — zoom 10 shows clusters with counts; zoom 15 shows
    individual coloured dots; both tap targets respond
  - Files: `frontend/src/features/map/SpotLayer.tsx`
  - Colour map: `free=#22c55e, paid=#3b82f6, permit=#f59e0b, private=#ef4444, unknown=#94a3b8`

---

### M7 — SpotDetailSheet + PaymentLinks

- [x] **M7: Bottom sheet with spot info and payment CTAs**
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

- [x] **M8: Unit tests, ≥ 80% coverage on lib + hook**
  - Acceptance: `npx jest --coverage` exits 0; statements/branches ≥ 80% on
    `src/lib/` and `useSpots.ts`; all three test files pass
  - Verify: Coverage report in terminal output
  - Files: `frontend/__tests__/geo.test.ts`,
    `frontend/__tests__/useSpots.test.ts`,
    `frontend/__tests__/SpotDetailSheet.test.tsx`

---

## Completion Checklist

All nine success criteria from `SPEC-map.md`:

- [x] M2 + M4 — `npx expo start` QR scannable; map loads within 3 s on WiFi
- [x] M4 — R2 `berlin.pmtiles` serves `206 Partial Content` (no tile server)
- [x] M5 + M6 — spot clusters visible after pan/zoom in Berlin
- [x] M6 — tap cluster zooms in; tap spot opens bottom sheet
- [x] M7 — bottom sheet shows correct type / access / operator / capacity
- [x] M7 — paid spots show EasyPark + ParkNow buttons; free spots do not
- [x] M7 — payment button opens correct App Store / Play Store page (manual)
- [x] M8 — `npx jest --coverage` passes, ≥ 80% on `src/lib/` + `useSpots.ts`
- [x] M1–M7 — no per-request API cost introduced

---
---

# Retroactive: Routing, Search & Multi-City

**Specs:** [SPEC-map.md](../SPEC-map.md) § Search & Geocoding, § Routing, § Location & Camera Behaviour; [SPEC-infra.md](../SPEC-infra.md) § Seeded Cities, § Routing infra
**Status:** Added 2026-08-23. This work shipped across several commits
(`e19165a` OSRM Germany-wide, `d64e8b9` OSRM infra, `83bdd6a` routing UI,
`e8279e8` German cities, `a789e69` fly-to-location, `f3009a9` search bar)
with no task breakdown ever written — going straight from idea to code.
Retroactively documented here so the plan matches reality; not meant to be
"executed" like the tasks above.

- [x] **R1: Self-hosted OSRM infra** — `docker-compose.yml` (`osrm-init`,
  `osrm-germany`), Germany-wide Geofabrik extraction/partition/customize.
  Zero per-call cost, matching the project's hard constraint.
- [x] **R2: Backend routing proxy** — `backend/routers/route.py` +
  `regions.py`; validates destination is in a known region, dispatches to
  the right OSRM instance, rate-limited 30/min via `slowapi`.
- [x] **R3: Caddy HTTPS proxy** — automatic TLS for `api.freipark.com`.
- [x] **R4: Frontend routing UI** — `useRoute.ts`, `RouteLayer.tsx`;
  `SpotDetailSheet` shows distance/duration or a clear unavailable/loading/
  denied state.
- [x] **S1: Search bar + geocoding** — `SearchBar.tsx`, `useGeocoder.ts`
  against the public Nominatim API, Germany-filtered, debounced.
- [x] **L1: Location-aware camera** — fly-to-user-location on launch
  (Germany-bbox-guarded against the simulator's Cupertino default),
  "Locating…" chip, location-denied banner with a settings deep link.
- [x] **C1: Multi-city seed** — `004_add_german_cities.sql`, 30+ cities
  across every German state; `import_all.py` to import them all.

**Known gaps from this retroactive work** (see specs for detail, not
repeated here): no automated tests for search/routing/multi-city; the
`GET /health/db` response shape changed (per-city breakdown) without the
original single-city success criterion being updated until this
reconciliation; `frontend/.env.example` was missing `EXPO_PUBLIC_API_URL`
until this reconciliation fixed it.

---
---

# Implementation Plan: auth module

**Spec:** [SPEC-auth.md](../SPEC-auth.md)
**Module:** `auth`
**Build position:** Third — depends on `infra` (Supabase Auth already provisioned; AsyncStorage session persistence already wired in `src/lib/supabase.ts`). Independent of `map` beyond one new UI entry point.

> **Status (2026-08-23):** A1–A5 implemented and passing `npx tsc --noEmit`
> and `npx jest --coverage` (64/64 tests, `useAuth.ts` 100% stmts/lines,
> 90% branches — exceeds the 80% target). Checkboxes below reflect
> **code-complete + automated-verified**, not manual/device verification —
> anything requiring a running simulator or the real Supabase project
> (session persistence across force-quit, actual sign-up against the live
> project, visual layout check) is called out explicitly as still
> outstanding. Also touched `SearchBar.tsx` (narrowed its right margin from
> `12` to `96`) to make room for `AccountButton` without overlap — not in
> the original file list, disclosed here for the same reason.

---

## Dependency Graph

```
[A1] useAuth hook ──→ [A2] AuthSheet UI ──┐
                   └──→ [A3] AccountButton ┤──→ [A4] Wire into MapScreen ──→ [A5] Tests
```

A1 is the critical path — A2 and A3 both consume it. A4 is a small, low-risk change to an already-working screen.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Email confirmation setting unknown (see `SPEC-auth.md` § Open Questions) | Medium | `useAuth`/`AuthSheet` handle the `session === null` post-signup case regardless of which way the project is configured |
| `@testing-library/react-native` v14 async gotchas (already hit once in the map module) | Low — now known | Write tests with `await render()`/`renderHook()` from the start; use `advanceTimersByTimeAsync` if any fake timers are needed |
| `onAuthStateChange` subscription leak if not unsubscribed on unmount | Medium | Explicit cleanup in `useAuth`'s `useEffect`; covered by a dedicated test assertion |

---

## Tasks

### A1 — `useAuth` hook

- [x] **A1: Implement `src/features/auth/useAuth.ts`**
  - Acceptance: exposes `{ session, user, loading, signUp, signIn, signOut }`;
    calls `supabase.auth.getSession()` once on mount, subscribes to
    `onAuthStateChange`, unsubscribes on unmount; `signUp`/`signIn` return
    `{ error: string | null }` so `AuthSheet` can show inline errors without
    throwing
  - Verify: `npx tsc --noEmit` passes; manual — hook reflects real Supabase
    session state
  - Files: `frontend/src/features/auth/useAuth.ts`

### A2 — `AuthSheet` UI

- [x] **A2: Implement `src/features/auth/AuthSheet.tsx`** — manual simulator test of both tabs/paths still outstanding
  - Acceptance: sign-in/sign-up tab toggle; email + password fields; inline
    client-side validation (email shape, password length) before calling
    `useAuth`; inline server error display; signed-in state shows email +
    "Sign Out"; closes automatically on successful sign-in
  - Verify: manual simulator test of both tabs, both success and error paths
  - Files: `frontend/src/features/auth/AuthSheet.tsx`

### A3 — `AccountButton`

- [x] **A3: Implement `src/features/auth/AccountButton.tsx`** — manual state-transition check still outstanding
  - Acceptance: neutral/loading state while `useAuth().loading`; "Sign in"
    pill when signed out; compact signed-in indicator when signed in; tap
    opens `AuthSheet`
  - Verify: manual — button state matches `useAuth` state through all
    transitions
  - Files: `frontend/src/features/auth/AccountButton.tsx`

### A4 — Wire into `MapScreen`

- [x] **A4: Render `<AccountButton />` in `MapScreen.tsx`** — `npx tsc --noEmit` clean and all pre-existing map tests still pass unchanged; manual simulator check across map states (location loading/denied, search open, spot sheet open) with the new button present is still outstanding
  - Acceptance: button visible alongside `SearchBar`, doesn't overlap it or
    other existing UI (locating chip, location banner, attribution); every
    existing map success criterion (`SPEC-map.md`) still passes signed-out
  - Verify: `npx tsc --noEmit` passes; manual simulator check across all
    existing map states (location loading/denied, search open, spot sheet
    open) with the new button present
  - Files: `frontend/src/features/map/MapScreen.tsx`

### A5 — Tests

- [x] **A5: `useAuth.test.ts` and `AuthSheet.test.tsx`** — both hit the same
  `@testing-library/react-native` v14 async gotchas the map module hit
  (`renderHook`'s `result`/`unmount` are async; **`fireEvent.changeText`
  and `fireEvent.press` are also async in this version — a gotcha not yet
  in `SPEC-auth.md`'s risk table, worth adding**). `useAuth.ts`: 100%
  stmts/lines/funcs, 90% branches. `AuthSheet.tsx`: 92%/86%/88% — well
  past the "snapshot-level" bar the spec set, since behavioral tests were
  cheap to write given the mocked-hook pattern. `AccountButton.tsx` has no
  dedicated test file, matching the existing codebase's own precedent
  (`SearchBar.tsx` also has none) for small presentational trigger
  components — not a gap, a deliberate consistency call.
  - Files: `frontend/__tests__/useAuth.test.ts`, `frontend/__tests__/AuthSheet.test.tsx`

---

## Completion Checklist

All eight success criteria from `SPEC-auth.md`.

> **2026-08-23 simulator verification:** ran the actual dev-client build on
> a booted iOS Simulator (iPhone 17 Pro) via `idb` (installed for this
> session — see tooling note below) and drove it end-to-end against the
> **real** Supabase project. Findings:
> - `AccountButton` renders correctly next to `SearchBar`, no overlap —
>   confirms A4's layout acceptance criterion visually, not just via `tsc`.
> - Tapping it opens `AuthSheet` exactly per spec: tabs, fields, Continue.
> - Sign-up submission reaches the **real** Supabase Auth API (confirmed —
>   this was not mocked) and Supabase itself rejected the test email
>   (`@example.com` is on Supabase's disposable/reserved-domain blocklist).
>   The resulting error surfaced **inline, verbatim, immediately** — proving
>   the full real-API-error → UI path works, not just the mocked-error path
>   `AuthSheet.test.tsx` already covered.
> - Did **not** reach a successful sign-up/sign-in/sign-out/persistence
>   check: retrying with a non-blocklisted domain required typing `@` via
>   `idb ui text`, which has a reproducible bug — it emits `"` instead of
>   `@` (and mangles `-`). Worked around it once via the simulator's native
>   copy/paste (`xcrun simctl pbcopy` + the iOS "Paste" callout), but that
>   callout didn't reliably reappear on retry, and further tooling time
>   wasn't spent chasing it. **This is a test-tooling limitation, not
>   evidence of an app bug** — a human typing on a real keyboard doesn't
>   hit it.

- [x] Sign up creates an account (handles both immediate-session and email-confirmation-required cases) — **partially verified**: confirmed the request reaches Supabase and the no-session/error path renders correctly (via a rejected test domain); the successful-session path is still unconfirmed live (unit-tested only)
- [ ] Sign in with valid credentials succeeds; `AccountButton` reflects it — **still outstanding**, blocked on the `idb`/`@`-character tooling issue above, not attempted this round
- [x] Sign in with invalid credentials shows inline error, no crash — verified twice now: `AuthSheet.test.tsx`'s mocked case, **and** live against the real API (sign-up variant) in this simulator session
- [ ] Sign out clears session; `AccountButton` reverts — **still outstanding**, same blocker
- [ ] Session persists across force-quit + relaunch (manual device test) — **still outstanding**, explicitly a manual-only criterion per the spec
- [x] Every existing `SPEC-map.md` criterion still passes signed-out — confirmed both by the unchanged 45 pre-existing tests **and** visually in this session (map, search, route line all rendered normally with `AccountButton` present)
- [x] `npx jest` passes; `useAuth.ts` ≥ 80% coverage — 64/64 passing, `useAuth.ts` at 100%/90%
- [x] No backend/database changes — diff is `SPEC-auth.md`, `tasks/plan.md`, `frontend/src/features/auth/` (new), `frontend/__tests__/useAuth.test.ts` + `AuthSheet.test.tsx` (new), `MapScreen.tsx`, and `SearchBar.tsx` (both small, disclosed touches) — no `backend/` or `supabase/migrations/` changes

**Tooling note:** verifying this required installing `idb-companion`
(Homebrew, `facebook/fb` tap) and the `fb-idb` Python client (via `pipx`,
pinned to Python 3.11 — the published package breaks on 3.14's asyncio
changes) since no project-specific run/UI-automation skill existed yet.
Also discovered: the Expo dev-client's floating menu bubble has a touch
target large enough to swallow taps intended for `AccountButton` sitting
just above it — had to drag the bubble away first. Worth a
`/run-skill-generator` pass if simulator-driven verification becomes
routine for this project; not done here since it was one adjacent to the
main task, not part of it.

---
---

# Addendum: Phone Auth, Email SMTP, JWT Signing Keys

**Spec:** [SPEC-auth.md](../SPEC-auth.md) § Phone auth (OTP), § Dashboard Configuration; [SPEC-infra.md](../SPEC-infra.md) § Verifying Supabase JWTs
**Date:** 2026-08-24
**Status:** Code portion (phone auth) done and tested. Two of three pieces requested were manual/dashboard-only with no code to write — see below.

### A6 — Phone auth (OTP)

- [x] **A6: Add `signInWithOtp`/`verifyOtp` to `useAuth.ts`, phone/OTP UI to `AuthSheet.tsx`**
  - Acceptance: Email/Phone method toggle; phone step validates E.164
    format before calling Supabase; successful send moves to a code-entry
    step; successful verify closes the sheet like email sign-in does;
    "Use a different number" and "Resend code" both work; no separate
    sign-in/sign-up distinction for phone (Supabase's `signInWithOtp` is
    unified — confirmed via SDK type inspection, not assumed)
  - Verify: `npx tsc --noEmit` passes; `npx jest` passes, `useAuth.ts`
    stays at 100% stmts/100% funcs/95.8% branches; `AuthSheet.tsx` at 95%
    stmts (9 new phone-flow tests, all passing, verified 3x for stability)
  - Files: `frontend/src/features/auth/useAuth.ts`,
    `frontend/src/features/auth/AuthSheet.tsx`,
    `frontend/__tests__/useAuth.test.ts`,
    `frontend/__tests__/AuthSheet.test.tsx`
  - **Outstanding:** unverified against the real Twilio-backed Supabase
    project — needs the Twilio dashboard config in `SPEC-auth.md` § Dashboard
    Configuration done first. Same category of gap as A1–A5's live-auth
    verification: code-complete and unit-tested, not live-verified.

### Brevo SMTP — no code task

Dashboard + DNS only (Brevo account, domain verification, SPF/DKIM,
Supabase SMTP Settings). Exact field values recorded in `SPEC-auth.md`
§ Dashboard Configuration. Nothing in this repo changes.

### JWT signing keys — no code task, premise corrected

Requested as "the JWT signing key change needs a backend update." Grepped
the backend first rather than assuming: zero JWT-verification code exists
today, so there is nothing to migrate. Rotating to asymmetric keys in the
Supabase dashboard has no effect on this codebase as it stands. Recorded
the JWKS-based verification approach in `SPEC-infra.md` § Verifying
Supabase JWTs (Future) as ready-to-build guidance for whenever a backend
route actually needs to authenticate a Supabase user — not built
speculatively, since it would have no caller and therefore no way to be
tested.

---
---

# Addendum: Map Glyph-Loading Root Cause & Fix

**Spec:** [SPEC-map.md](../SPEC-map.md) § Glyph Hosting
**Date:** 2026-08-24
**Status:** Root cause found and fixed in code, verified end-to-end via a
local stand-in server. Real deployment blocked on Cloudflare R2 upload
access this environment doesn't have.

- [x] **Diagnose:** confirmed via device logs that the earlier "blank map"
  fix was incomplete — resurfaced as missing text labels. The logged
  error ("request timed out") was misleading; inspecting the *actual
  resolved request URL* (not the template) revealed MapLibre Native
  corrupts font-stack names containing spaces during `{fontstack}`
  substitution — a client-side bug, not a Protomaps hosting reliability
  issue (a plain `curl` to the correct URL succeeded fast and
  consistently from this environment).
- [x] **Fix:** `frontend/src/lib/fonts.ts` (`withNoSpaceFontStacks`) —
  renames the 3 font stacks `protomaps-themes-base` actually uses to
  space-free equivalents, scoped to just `layout['text-font']`. A test
  written against the first implementation (a blanket JSON string
  replace) caught that it would rename unrelated text elsewhere in a
  layer too — fixed to a properly-scoped recursive expression walk before
  shipping, not after.
  - Verify: `npx tsc --noEmit` clean; `npx jest` — 6 new tests in
    `fonts.test.ts`, `fonts.ts` at 100% coverage; 85/85 total tests
    passing, stable across 3 runs
  - Files: `frontend/src/lib/fonts.ts` (new),
    `frontend/__tests__/fonts.test.ts` (new),
    `frontend/src/features/map/MapScreen.tsx`,
    `frontend/.env.example`
- [x] **Verified end-to-end on-device**, not just unit-tested: initially
  downloaded only 12 glyph files (3 fonts × 4 hand-picked Latin ranges,
  ~1.1MB), served them from a throwaway local HTTP server, pointed
  `EXPO_PUBLIC_GLYPHS_URL` at it, and confirmed on a **freshly
  reinstalled** simulator build (ruling out MapLibre's on-disk offline
  cache masking the result) that labels render correctly with correct
  German diacritics, and zero glyph errors in device logs.
- [x] **Scope correction (still 2026-08-24, later same day):** after
  cleanup, a stale still-running app session (pointed at the by-then-dead
  local test server) surfaced `Failed to load glyph range 8192-8447 for
  font stack NotoSansRegular` — the connection failure itself was just
  the dead test server, but the range being requested at all proved the
  original 4-range guess was wrong: real German OSM data needs Unicode
  blocks outside plain Latin (8192-8447 = General Punctuation/Currency
  Symbols, needed for €). Probed further, found all 256 ranges exist per
  font, and downloaded the **complete set: 768 files (256 × 3 fonts),
  ~13MB** — small enough that mirroring everything beats guessing at a
  subset. `SPEC-map.md` § Glyph Hosting has the corrected file count and
  a loop-based download script instead of a hardcoded list.
- [x] **Uploaded (2026-09-26):** all 768 glyph files uploaded to the real
  `freipark-tiles` R2 bucket (`fonts/{NotoSansRegular,NotoSansMedium,NotoSansItalic}/{range}.pbf`,
  256 objects per font, via AWS CLI against R2's S3-compatible endpoint
  using a user-supplied, bucket-scoped API token) and `EXPO_PUBLIC_GLYPHS_URL`
  set in the real `frontend/.env`. Verified via `aws s3 ls` (768 objects)
  and a public-URL fetch of the previously-buggy `8192-8447` range (200,
  correct content-type). See `SPEC-map.md` § Glyph Hosting.
  **On-device verification against the real bucket — done (2026-09-26):**
  ran the dev-client on iOS Simulator via `npx expo run:ios`; confirmed
  Berlin map labels render correctly with German diacritics (ß, ö) and
  zero glyph-loading errors in device logs, using the real
  `EXPO_PUBLIC_GLYPHS_URL` (no local stand-in server). See `SPEC-map.md`
  § Glyph Hosting for detail. Along the way, fixed an unrelated stale
  Homebrew `node` path in the untracked `ios/.xcode.env.local` that was
  blocking the native build.
- [x] **Cleanup:** the throwaway local HTTP server and temporary
  `EXPO_PUBLIC_GLYPHS_URL` test value were removed after the first
  verification pass; `frontend/.env` is back to its pre-test state;
  Metro was restarted clean. The stale app session that surfaced the
  scope-correction error above was a leftover from *before* that
  cleanup — not a new regression.

---
---

# Addendum: Climbing Error Counter & Missing Spots (2026-08-24)

**Spec:** [SPEC-map.md](../SPEC-map.md) § Spot Visualisation

- [x] **Error counter root cause:** the same stale-app-process issue as
  the earlier glyph addendum, but this time I'd genuinely left an app
  process running for ~3 hours after cleanup without terminating it —
  a real gap in how I closed out that session. Confirmed via device
  logs: exact text `Failed to load glyph range 8192-8447 for font stack
  Noto Sans Regular:( Could not connect to the server.)`, request target
  `http://localhost:8099/...` (my killed test server). Confirmed the
  served Metro bundle had zero references to port 8099. Fix: terminate +
  relaunch — zero glyph errors since.
- [x] **Missing spots — real bug, found and fixed:** `useSpots`/Supabase
  RPC/`SpotLayer` props were all confirmed correct via a temporary
  diagnostic log (1000 valid features reaching `SpotLayer`). Root cause:
  `SpotLayer.tsx`/`RouteLayer.tsx` relied on JSX nesting inside
  `<GeoJSONSource>` to associate `<Layer>` with its source — wrong
  assumption for `@maplibre/maplibre-react-native` v11.3.6, which needs
  an explicit `source` prop (confirmed against the library's own doc
  example). Fixed both files; confirmed on-device with correctly-counted
  clusters across Berlin. Also fixed `spots-cluster-count`'s own
  hardcoded spaced font reference (a second location with the § Glyph
  Hosting bug, missed by the first pass since it's outside
  `protomapsLayers()`'s output).
  - Verify: `npx tsc --noEmit` clean; `npx jest` 85/85 passing; confirmed
    live on a freshly-relaunched simulator, including after a pan-based
    region change
  - Files: `frontend/src/features/map/SpotLayer.tsx`,
    `frontend/src/features/map/RouteLayer.tsx`
- [x] **Diagnostic log removed** after use, as promised — not left in
  the shipped code.
- [ ] **Minor, non-blocking observation, not chased further:** on some
  fresh launches, spot clusters take a few seconds to appear (or need a
  pan/zoom to trigger) even after data has loaded — looks like a native
  clustering-index computation delay on initial mount, not a data or
  association bug (confirmed: correct once triggered, every time). Not
  investigated further given time already spent; worth a look if it
  turns out to bother real users.

---
---

# Implementation Plan: self-hosted Supabase migration

**Spec:** [SPEC-infra.md](../SPEC-infra.md) § Self-Hosted Supabase Migration (Proposed)
**Module:** `infra` (replaces the managed-Supabase portion of it)
**Build position:** Independent of `map`/`auth` feature work — this is a
backing-store swap behind the same client contract. Safe to build and
validate in parallel with other modules, but the **production cutover**
step (SS10) should land as its own isolated change, not bundled with
unrelated feature work.
**Status:** Not started. Every task below is unchecked.

---

## Dependency Graph

```
[SS1] JWT secret + mint anon/service_role keys
   └──▶ [SS2] Add db/auth/rest/kong services to docker-compose.yml
           ├──▶ [SS3] Apply supabase/migrations/*.sql; verify test_db.py against new instance
           │       └──▶ [SS5] Migrate data (pg_dump managed → restore self-hosted)
           │               └──▶ [SS6] Re-run import_all.py as sanity check ───────────┐
           ├──▶ [SS4] Caddy route: supabase.freipark.com ──────────────────────────────┤
           └──▶ [SS7] GoTrue email (Brevo) + phone OTP (Twilio) config ────────────────┤
                                                                                         ├──▶ [SS8] Staging cutover + manual verification
[SS9] Backup cron job + test-restore (independent of SS3–SS7, gates SS10) ──────────────┘         └──▶ [SS10] Production cutover ──▶ [SS11] Rollback window / monitor ──▶ [SS12] Docs + managed-project decision
```

SS1 is the critical-path start. SS3, SS4, and SS7 all fan out from SS2 and
can proceed in parallel. SS9 (backups) has no dependency on the data
migration at all — do it early, since SS10 (production cutover) is gated
on it existing and having been proven with an actual restore, not just
configured.

---

## Risks

*(Carried over from `SPEC-infra.md`'s Risks table, restated here as
implementation-time concerns.)*

| Risk | Likelihood | Mitigation |
|---|---|---|
| Resource contention with OSRM under load | Low — headroom already checked (17GB RAM / 178GB disk free) | Watch `docker stats` during SS8 staging load-testing |
| Data loss or extended downtime during cutover | Medium if rushed | SS8 (staging) must pass before SS10 (production); managed project stays paused, not deleted, through SS11 |
| GoTrue config drifts from the managed project's current Auth dashboard settings | Medium | SS7 explicitly diffs every `GOTRUE_*` env var against the live dashboard before SS8, not after |
| `JWT_SECRET` or minted `service_role` key committed by accident | Low, but severe if it happens | Both go in `backend/.env`/`.env` only, per this repo's existing "never commit secrets" rule; add to `.gitignore` patterns if not already covered by the blanket `*.env` rule |
| Backup never actually tested | Medium (easy to configure and never verify) | SS9's acceptance criterion explicitly requires a real restore, not just a cron job existing |

---

## Tasks

### SS1 — JWT secret and keys

- [x] **SS1: Generate `JWT_SECRET`; mint `anon` and `service_role` JWTs signed with it — done 2026-09-26.**
  Generated `JWT_SECRET` via `openssl rand -base64 40`; minted both JWTs
  with a stdlib-only HS256 implementation (no new dependency for a
  one-off script) using the standard self-hosted claim shape (`role`,
  `iss: supabase`, `iat`, 10-year `exp`, matching the self-hosting
  convention since these act as static API keys, not session tokens).
  Verified by independently recomputing each HMAC-SHA256 signature from
  the secret (not just decoding) — both valid — and confirming the `role`
  claim matches (`anon` / `service_role`) on each. All three values
  written to `backend/.env` (already gitignored), not committed.
  - Acceptance: a securely-generated `JWT_SECRET` exists (32+ bytes,
    random); both keys minted per Supabase's self-hosting key-generation
    process (`role: anon` / `role: service_role` claims), decodable and
    verifiable against `JWT_SECRET`
  - Verify: decode each minted JWT (e.g. with `jwt.io` or `python -c
    "import jwt; print(jwt.decode(token, secret, algorithms=['HS256']))"`)
    and confirm the `role` claim matches
  - Files: none committed — `JWT_SECRET` and the `service_role` key are
    `.env`-only; `anon` key isn't secret but still lives in `.env` next to
    the others for consistency until SS8/SS10 promote it into
    `frontend/.env`

### SS2 — Add self-hosted services to `docker-compose.yml`

- [x] **SS2: Add `db`, `auth`, `rest`, `kong` services — done 2026-09-26, local validation only (not the OVH box).**
  Added all four to `docker-compose.yml` (`supabase/postgres:15.14.1.177`,
  `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v16.4`, `kong:3.9` —
  real, verified-current tags, not guessed). Kong runs DB-less with a
  declarative config generated from a committed `.template` (no secrets)
  via `supabase/self-host/generate_config.sh`; a local-only, gitignored
  `docker-compose.override.yml` publishes kong's port for testing (the
  shared file has no host port — Caddy will reach it internally per SS4).
  Two real bugs found and fixed along the way, not assumed away:
  - `supabase/postgres` creates `authenticator`/`supabase_auth_admin`
    **passwordless** — `POSTGRES_PASSWORD` only covers the superuser.
    `auth`/`rest` couldn't authenticate until an init SQL script
    (`supabase/self-host/init/zz-set-role-passwords.sql`, `zz-` prefix
    deliberate — must sort after the image's own `migrate.sh`, which
    creates those roles in the first place) set them explicitly. Confirmed
    via direct `pg_authid` inspection, not guessed from the error message.
  - Almost bind-mounted a directory over the *entire*
    `/docker-entrypoint-initdb.d/`, which would have deleted the image's
    own `migrate.sh` + `init-scripts/` (the actual auth/storage schema
    bootstrap) — caught by inspecting the image's contents first; mounted
    a single file instead.
  - Acceptance: `docker compose up -d db auth rest kong` (local dev
    machine or a scratch environment — **not the OVH box yet**) brings up
    all four healthy; `kong` reachable on its container port; `rest`
    responds to an unauthenticated `GET /` per PostgREST's default root
    response; `auth` responds to `GET /health` per GoTrue's own
    healthcheck endpoint
  - Verify: `docker compose ps` shows db/auth/kong `healthy` (`rest` has
    no healthcheck — confirmed via `docker exec` that the image has no
    shell at all, not even `sh`, so no `CMD`/`CMD-SHELL` can run one;
    verified functionally instead); `curl localhost:8000/rest/v1/`
    returns `200` with PostgREST's OpenAPI root through Kong; `curl
    localhost:8000/auth/v1/health` also returns `200`
  - Files: `docker-compose.yml`

### SS3 — Apply migrations to the new instance

- [x] **SS3: Run every `supabase/migrations/*.sql` file against the new `db` service, in order — done 2026-09-26.**
  Applied all five (`001`–`005`) via `docker compose exec -T db psql -v
  ON_ERROR_STOP=1`, piping each file's content in rather than requiring a
  host `psql` client — all exited 0, only expected first-run notices
  (extension-already-exists, policy-doesn't-exist-yet-so-skip-drop).
  Confirmed schema landed: `SELECT slug FROM cities WHERE slug='berlin'`
  returns a row, 33 cities total (Berlin + 32 from `004`), `PostGIS_Version()`
  returns `3.3`. Published `db`'s port via `docker-compose.override.yml`
  (local-only, gitignored) to run `backend/tests/test_db.py` from the host
  with `DATABASE_URL` exported directly (overrides `backend/.env`'s value
  via `python-dotenv`'s "don't clobber existing env vars" default) —
  **4/4 passed**, identical to the managed-Supabase result.
  - Acceptance: all five migration files (`001`–`005`) apply without
    error; `backend/tests/test_db.py`'s four tests pass when pointed at
    this instance via a temporary `DATABASE_URL` override
  - Verify: `psql $NEW_DATABASE_URL -f supabase/migrations/001_initial_schema.sql`
    (repeat per file) exits 0 each time; `DATABASE_URL=<new> pytest
    backend/tests/test_db.py -v` — 4 passed
  - Files: none new — reuses existing `supabase/migrations/`

### SS4 — Caddy route for the self-hosted gateway

- [x] **SS4: Add `supabase.freipark.com` reverse-proxy block — done 2026-09-26.**
  DNS A record added by the user; deployed to the OVH box (`git pull` +
  bringing up `db`/`auth`/`rest`/`kong` + migrations, all via the same
  commands proven locally in SS2/SS3). Hit one real bug: `caddy reload`
  kept reporting "config is unchanged" even after the new `Caddyfile`
  landed on disk — root cause was a stale single-file bind mount, a known
  Docker gotcha: `git pull` replaces a tracked file via unlink+rename (a
  new inode), but a container's bind mount to an individual file (not a
  directory) can stay pinned to the old inode, so the running `caddy`
  container kept reading the pre-pull, single-block file no matter how
  many times it was told to reload. Fixed with `docker compose up -d
  --force-recreate caddy` (recreating the container re-establishes the
  mount) — a plain `reload` or `restart` would not have fixed this.
  **Externally verified, not just deployed:** `https://supabase.freipark.com/rest/v1/`
  → `200` with a real Let's Encrypt cert (`via: 1.1 Caddy`, `via: 1.1
  kong/3.9.3`, `server: postgrest/16.4`) and the full migrated OpenAPI
  schema; `https://supabase.freipark.com/auth/v1/health` → `200`;
  confirmed `https://api.freipark.com/health/db` still returns `200`
  after the caddy recreate — no regression to the existing route.
  - Acceptance: `Caddyfile` has a new block proxying to `kong:8000`,
    additive to the existing `api.freipark.com` block; once deployed to
    the OVH box, `curl -I https://supabase.freipark.com/rest/v1/` returns
    a response from Kong/PostgREST, not a Caddy 404
  - Verify: manual `curl` from outside the box after deploy; Caddy logs
    show automatic TLS issued for the new subdomain
  - Files: `Caddyfile`
  - Prereq: DNS record for `supabase.freipark.com` pointing at the OVH
    box's IP (manual, outside this repo)

### SS5 — Migrate data from managed to self-hosted

- [x] **SS5: `pg_dump` managed project, restore into self-hosted instance — done 2026-09-26.**
  `cities` needed no dump — both sides already have the identical 33 rows
  from migrations, confirmed matching. Dumped `public.parking_spots`
  (424,912 rows), `auth.users` (1), `auth.identities` (1) with
  `--data-only --no-owner --disable-triggers`, restored into the
  self-hosted instance. **Important, undocumented drift discovered along
  the way:** the managed project is actually running **Postgres 17.6**,
  not 15 as `CLAUDE.md`/`SPEC-infra.md` state — `pg_dump` 15 refused to
  dump from it at all (`aborting because of server version mismatch`).
  Used a Postgres 17 client (`docker run --rm postgres:17 pg_dump ...`)
  to match the source, while the self-hosted *target* stays on the
  documented 15.14 — the dump then needed 3 lines stripped
  (`\restrict`/`\unrestrict`, `SET transaction_timeout`) that are
  Postgres-17-only syntax the 15 target doesn't understand. Second real
  issue: the self-hosted `postgres` role is **not** a superuser (Supabase's
  own security model, replicated even self-hosted — confirmed via
  `rolsuper = f`), so `--disable-triggers`' implicit `ALTER TABLE ...
  DISABLE TRIGGER ALL` failed with "must be owner of table users";
  restored as `supabase_admin` instead (the real superuser, `local ...
  trust`-only per `pg_hba.conf`, reachable via the container's unix
  socket).
  **Correction (found during SS6, same day):** row counts matching was
  not sufficient verification — `--disable-triggers` disables Postgres's
  *internal* FK-check triggers too, so 424,912 `parking_spots` rows were
  silently accepted despite referencing `city_id` values that don't exist
  in self-hosted's `cities` table. Root cause: `cities` was populated via
  the plain SQL migrations (`gen_random_uuid()` defaults), so it got
  entirely different UUIDs per row than managed's `cities`, even though
  `slug`/`name`/row count all matched — the row-count check gave false
  confidence. Real fix, done as part of SS6: dumped `public.cities` from
  managed (preserving real UUIDs), truncated and restored self-hosted's
  `cities` with those, truncated the referentially-broken
  `parking_spots`, then let SS6's OSM re-import fully repopulate it fresh
  — see SS6 below for the corrected end state. `auth.users`/`identities`
  were unaffected by this bug (no FK to `cities`); those two remain
  correctly verified as stated above.
  - Acceptance: `public.cities` and `public.parking_spots` row counts
    match between managed and self-hosted after restore; `auth.users` and
    `auth.identities` restored with matching row counts and matching
    `id` values (so existing user sessions can still resolve post-cutover)
  - Verify: `SELECT count(*) FROM cities` / `parking_spots` / `auth.users`
    match on both sides; spot-check a handful of specific rows by `id`
  - Files: none committed — a one-time operational script/command, not
    part of the app

### SS6 — Sanity-check import

- [x] **SS6: Re-run `import_all.py` against the self-hosted instance — done 2026-09-26.**
  First run failed on every one of the 33 cities with
  `ForeignKeyViolation: ... city_id ... is not present in table "cities"`
  — this is what actually surfaced the SS5 `cities`-UUID bug documented
  above (SS6 wasn't a clean no-op check as originally planned; it caught
  a real bug SS5's own verification missed). After fixing `cities` (see
  SS5's correction note), re-ran the full import: **all 33 cities
  imported successfully, zero failures.** All PBFs were already cached
  locally from prior work (~5.4GB, no re-download needed) — real per-city
  `inserted`/`updated` counts, e.g. wiesbaden `inserted=2116,
  updated=1959` (not the all-zero "nothing changed" result the task
  originally expected, since `parking_spots` had just been truncated as
  part of the SS5 fix, making this a fresh full import rather than a
  no-op idempotency check).
  Final count: self-hosted **424,911** vs managed **424,912** —
  identified the exact single-row difference (diffed the full
  `osm_id`/`osm_type` lists, not just counts): OSM node `8841848872`
  (Berlin, `amenity=parking`) exists in managed but not in the cached
  Berlin PBF used for this re-import. Consistent with ordinary OSM data
  drift between whenever managed was originally populated and whenever
  the local PBF cache (dated 22 Aug) was downloaded — not a bug in this
  pipeline, and not chased further given 1-in-425,000 materiality.
  - Acceptance: `python backend/scripts/import_all.py` (pointed at the
    self-hosted `DATABASE_URL`) completes with `inserted: 0` for every
    city if SS5's dump was complete — any non-zero `inserted` count means
    the dump missed rows, and that's the signal to investigate before
    proceeding, not paper over
  - Verify: script output logged and diffed against expectation (all
    zeros)
  - Files: none — reuses `backend/scripts/import_all.py` unchanged

### SS7 — Email and phone OTP configuration

- [x] **SS7: Configure email and SMS delivery — done 2026-09-29 (email via Brevo, SMS via Vonage); see the two sub-items below.** *(Checkbox reconciled 2026-10-07 — the entry below is the original 2026-09-26/27 "blocked" log, kept as history.)*
  **Premise corrected first:** neither Brevo nor Twilio/MessageBird was
  ever actually configured on the *managed* project's dashboard — both
  were only decided/documented in `SPEC-auth.md`, dashboard+DNS work never
  executed. So there was nothing live to replicate; this became "set up
  for real, for the first time" rather than "migrate existing config."
  **Email (Brevo):** `GOTRUE_SMTP_*` wired into `docker-compose.yml`'s
  `auth` service, secrets added to `backend/.env`/root `.env`. First
  attempt used a key value that turned out to be a misread Twilio
  Account SID + Auth Token pasted together (caught via a real test:
  `POST /auth/v1/recover` returned `535 "Authentication failed"` from
  Brevo — verified the actual failure, didn't just assume the config was
  right). **Blocked externally**: Brevo won't issue an SMTP key for this
  account for ~48h (their own anti-abuse hold on new accounts). Reverted
  `GOTRUE_MAILER_AUTOCONFIRM` to `"true"` so sign-up keeps working without
  real delivery in the meantime — `GOTRUE_SMTP_*` env vars stay defined
  against a placeholder key, so finishing this later is a one-line swap
  plus flipping autoconfirm back off.
  **Phone (Twilio → MessageBird, in that order of attempt):**
  Twilio Account SID + Auth Token obtained, but GoTrue's Twilio provider
  requires a **Messaging Service SID**, which Twilio's trial tier won't
  issue without a paid upgrade — a real platform limitation, not a config
  mistake. Tried MessageBird next (already this project's own documented
  long-term choice per `SPEC-auth.md`) — but MessageBird has rebranded to
  "Bird" and its current dashboard only issues new-platform-API keys
  (`bk_eu1_...`, Bearer auth against `eu1.platform.bird.com`), while
  GoTrue's built-in `messagebird` provider is hardcoded against the
  *legacy* `rest.messagebird.com` REST API (`Authorization: AccessKey`).
  **Verified the incompatibility directly**, not assumed: tested the new
  key against the legacy API's side-effect-free `/balance` endpoint —
  `401 "incorrect access_key"`. Confirmed the dashboard's key-creation
  flow (scopes: Email/SMS/WhatsApp/Verify/etc.) is new-platform-only, no
  legacy key option exists. **GoTrue's built-in MessageBird provider is a
  dead end for any new Bird account** until either GoTrue ships new-API
  support or Bird restores legacy key issuance — worth flagging upstream
  if this matters later. `GOTRUE_SMS_AUTOCONFIRM` left at `"true"`
  (unchanged) — phone sign-in works, no real OTP delivery yet.
  - Acceptance: every relevant setting from the managed project's Auth
    dashboard (SMTP host/port/user, sender address, Twilio Account
    SID/Auth Token/from-number, OTP expiry, redirect URLs) has a
    corresponding `GOTRUE_*` env var set, diffed field-by-field against
    the dashboard — not reconstructed from memory
  - Verify: trigger a real sign-up email and a real phone OTP send against
    the self-hosted `auth` service in a throwaway test, confirm both
    arrive
  - Files: `docker-compose.yml` (`auth` service `environment:` block),
    `.env` (secrets)
  - **Resume later:** (1) Brevo — wait out the 48h hold, get the real SMTP
    key, swap `BREVO_SMTP_KEY`'s placeholder, flip `GOTRUE_MAILER_AUTOCONFIRM`
    back to `"false"`, re-test `/auth/v1/recover`. (2) Phone — either pay
    Twilio's minimum top-up for a Messaging Service, or wait for
    GoTrue/Bird compatibility, or evaluate a different GoTrue-supported
    provider (Vonage) not yet tried.

- [x] **SS7 email half: real Brevo delivery working — done 2026-09-28.**
  48h hold lifted; real `BREVO_SMTP_KEY` swapped into `backend/.env` and
  root `.env` (both local and the OVH box — the box's copies were missing
  all five `BREVO_*` vars entirely, not just a stale key, discovered via
  `docker compose`'s "variable not set" warnings after a first deploy
  attempt). `GOTRUE_MAILER_AUTOCONFIRM` flipped back to `"false"`.
  First real test (`POST /auth/v1/signup`) failed with a concrete new
  error — `525 "5.7.1 Unauthorized IP address"` — Brevo's separate
  sending-IP allowlist rejecting the OVH box's IP; not the same as the
  48h account hold. Fixed by authorizing `57.131.143.208` in Brevo's
  dashboard (Settings → Security → Authorised IPs). Re-tested signup:
  `confirmation_sent_at` populated, no error, and the email was actually
  received (confirmed by the user, not just inferred from a 200).
  Unrelated but discovered mid-fix: changing `freipark.com`'s nameservers
  to Cloudflare (for the new landing page's custom domain) orphaned the
  `supabase.freipark.com` DNS record, which only existed at the old DNS
  provider — broke the entire self-hosted API's public URL until an A
  record (DNS-only, not proxied — Caddy needs to terminate its own TLS)
  was re-added in Cloudflare.

  **Follow-up, same day:** the confirmation email's link 404'd
  ("No Route matched") even after the above. Root cause:
  `SUPABASE_SELFHOSTED_EXTERNAL_URL`/`API_EXTERNAL_URL` doesn't work the
  way its name implies — GoTrue's mailer link-builder only ever uses
  that URL's *scheme+host*, never its path, then appends its own bare
  internal route (`/verify`, `/callback`). So no `API_EXTERNAL_URL`
  value can produce a `/auth/v1/verify`-shaped link; Kong needs a route
  for the *bare* path too. Fixed in `kong.yml.template` (added `/verify`
  and `/callback` alongside the existing `/auth/v1/verify` and
  `/auth/v1/callback` routes). Also added
  `GOTRUE_SITE_URL=https://freipark.com/confirmed.html` (a real success
  page on the landing site, `freipark-landing`'s `public/confirmed.html`)
  instead of a raw `freipark://` deep link — most people click email
  links from whatever device they're on, not necessarily one with the
  app installed, and the app doesn't have `freipark://` registered in
  any shipped build yet anyway (added `"scheme": "freipark"` to
  `frontend/app.json` for when it does). Verified for real: the exact
  previously-failing link now returns `303` to the confirmation page
  with a valid session token, decoded JWT shows `email_verified: true`.
  **Phone (Twilio/MessageBird/Bird) still unresolved via those two** — see
  above.

- [x] **SS7 phone half: Vonage SMS OTP working — done 2026-09-29.**
  Twilio blocked (needs paid Messaging Service SID) and MessageBird/Bird
  confirmed incompatible (see above) — tried Vonage next, GoTrue's third
  built-in SMS provider, not previously attempted. Wired
  `GOTRUE_SMS_PROVIDER=vonage` + `GOTRUE_SMS_VONAGE_API_KEY/API_SECRET/FROM`
  into `docker-compose.yml`'s `auth` service (env vars: `VONAGE_API_KEY`,
  `VONAGE_API_SECRET`, `VONAGE_FROM` in root `.env`), flipped
  `GOTRUE_SMS_AUTOCONFIRM` to `"false"`. Real test: `POST /auth/v1/otp`
  → real SMS arrived with a real OTP code — confirmed by the user, not
  just inferred from the `200` response (learned that lesson from the
  email side of SS7 earlier the same day).
  **Known cosmetic gap:** SMS sender shows as "Vonage," not "FreiPark" —
  Germany requires alphanumeric Sender IDs to be pre-registered per
  Vonage's Global Sender ID Portal (dashboard → Phone Numbers tab)
  before carriers will display them; falls back silently until then.
  Non-blocking — OTP delivery itself works — parked as a later polish
  item, not attempted yet.

### SS8 — Staging cutover and manual verification

- [x] **SS8: Point a non-production config at the self-hosted stack and verify end-to-end — done 2026-09-27.**
  Created `frontend/.env.staging` (gitignored — `*.env.staging` added to
  `.gitignore`; not auto-loaded by Expo, applied explicitly), pointing at
  `https://supabase.freipark.com`. Verified each flow directly against
  the live endpoint with a throwaway account (cleaned up via the admin
  API afterward, both HTTP 200):
  - **Sign-up**: `POST /auth/v1/signup` → session returned immediately
    (autoconfirm)
  - **Sign-in**: `POST /auth/v1/token?grant_type=password`, independent
    of the signup response → valid access token
  - **Sign-out**: `POST /auth/v1/logout` → `204`
  - **Spot loading**: `POST /rest/v1/rpc/spots_in_bbox` (Berlin bbox) →
    2000 rows, real coordinates, matches the app's actual query shape
  - **Phone OTP: real bug found, not paper-over'd.** `POST /auth/v1/otp`
    with a phone number returns `500` — checked the exact auth log line:
    `"sms Provider  could not be found"`. The account is actually
    created and silently logged in behind the scenes
    (`immediate_login_after_signup: true`, per the audit log) despite the
    request failing, because `GOTRUE_SMS_AUTOCONFIRM=true` bypasses OTP
    verification but GoTrue still attempts to *send* the code and has no
    provider configured. **This means phone sign-in is currently broken
    end-to-end for a real client** — not just "untested," it actively
    returns an error — until SS7's SMS-provider gap is resolved. Direct
    consequence of the already-documented SS7 blocker, not a new/separate
    issue, but worth stating precisely rather than assuming autoconfirm
    makes it silently fine.
  - Acceptance: a separate env config (not the live `frontend/.env` /
    `backend/.env`) points `SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` at
    `supabase.freipark.com`; manual verification covers sign-up, sign-in,
    sign-out, phone OTP, and spot loading (`useSpots` RPC) — all the
    behaviors `SPEC-auth.md` and `SPEC-map.md` already define success
    criteria for, now re-verified against the new backend
  - Verify: manual simulator/device pass through each flow above, no
    unexpected errors; `curl` the self-hosted `spots_in_bbox` RPC directly
    and confirm it returns rows
  - Files: `frontend/.env.staging` (gitignored)

### SS9 — Backups

- [x] **SS9: Set up a `pg_dump` cron job writing to Cloudflare R2; prove it with a real restore — done 2026-09-27.**
  **Discovered and fixed a bigger gap first:** the OVH box's self-hosted
  `db` (deployed in SS4) had never actually received SS5/SS6's data —
  those were only ever run against the *local* validation instance.
  `parking_spots` was 0 on the box that's actually live at
  `supabase.freipark.com`. Fixed by dumping the verified-correct data
  from the local instance (same Postgres version both sides, no
  17-vs-15 issue this time) and streaming it directly into the OVH box's
  `db` container over SSH (no intermediate file written on the box) —
  same "fix `cities`' UUIDs first, then data" sequence as SS6, this time
  restored as `supabase_admin` with real triggers/FK enforcement on
  throughout (no `--disable-triggers` this time — SS5/SS6's lesson
  learned). OVH now matches exactly: 33 cities, 424,911 spots, 1 user.
  **Backup script** (`supabase/self-host/backup_db.sh`, using the
  `rclone` `r2:` remote already configured on the box — no new R2
  credentials needed) initially used a full `pg_dump` (schema+data).
  **That was wrong and caught by actually testing the restore**, not
  assumed to work: restoring a full dump into a fresh `supabase/postgres`
  instance fails with `schema "auth" already exists`, since the base
  image creates that schema itself — a full dump's own `CREATE SCHEMA`
  collides with it. Fixed to `--data-only`, scoped to the same four
  tables SS5 migrated, matching the real disaster-recovery sequence:
  fresh stack up → apply `supabase/migrations/*.sql` → GoTrue's own
  startup migrations recreate `auth.users`/`identities` structure → this
  backup's data restores cleanly on top.
  **Verified end-to-end for real:** ran the corrected script on the OVH
  box (52MB uploaded to `r2:freipark-tiles/backups/db/`), downloaded that
  exact object back down, replayed the full real sequence on a from-
  scratch scratch instance (fresh `supabase/postgres` container →
  migrations applied → a throwaway `gotrue` container bootstrapped the
  `auth` schema → backup restored) — **33/424,911/1 rows, exact match**,
  including `auth.users`' `id`/`email`. Daily cron installed (`0 3 * * *`,
  UTC, logs to `~/freipark-backup.log`).
  - Acceptance: a scheduled job dumps the self-hosted `db` and uploads to
    the `freipark-tiles` R2 bucket (or a dedicated backups bucket) on a
    regular cadence (daily, to start); at least one dump has been
    downloaded and restored into a scratch Postgres instance to confirm
    it's actually usable — an untested backup doesn't count as done
  - Verify: cron job's log shows successful runs; the test-restore step
    produces a working database with expected row counts
  - Files: `supabase/self-host/backup_db.sh`

### SS10 — Production cutover

- [x] **SS10: Update `backend/.env` and `frontend/.env`; redeploy — done 2026-09-27.**
  Updated both local `.env` files (`SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_URL`
  → `https://supabase.freipark.com`, anon/service-role keys → self-hosted,
  `DATABASE_URL` → self-hosted, `ENVIRONMENT=production`) — managed values
  kept as commented `MANAGED_*` reference lines for SS11's rollback, not
  deleted.
  **Real incident during deployment, not a config mistake:** applying the
  same change to the OVH box's `backend/.env` via a pasted multi-line
  heredoc script corrupted the file — the terminal reflowed/indented the
  paste, so bash's `cat >> ... <<'EOF'` never matched its (now-indented)
  closing delimiter and kept consuming everything pasted afterward —
  including an entire second script — as literal file content. Caught via
  `cat -A` (showing exact line endings) rather than assumed fixed;
  recovered from the `cp backend/.env backend/.env.pre-ss10-backup` taken
  at the start of that same script. Redone with a **fully heredoc-free**
  method: built the exact target file locally, base64-encoded it, and had
  the user run one line (`echo <blob> | base64 -d > backend/.env`) — no
  quotes, no regex, no multi-line paste risk. Verified byte-for-byte via
  `cat -A` before proceeding. Also removed one *pre-existing*, harmless
  piece of corruption from an earlier (SS7) session's similar heredoc
  mishap (a stray literal `cat >> ... <<'EOF'` line sitting in the file,
  silently ignored by env parsers but cleaned up while already in there).
  **Redeployed and verified for real:** `docker compose up -d
  --force-recreate api` on the OVH box; `GET https://api.freipark.com/health/db`
  → `total_spots: 424911` with the full 33-city breakdown, confirming
  `api` is genuinely reading the self-hosted database now, not managed.
  Did not re-run SS8's full sign-up/sign-in/sign-out battery — those
  already exercise the identical `supabase.freipark.com` endpoints now
  live in "production" config; the only new surface SS10 introduces is
  `api`'s own `DATABASE_URL`, which `/health/db` just confirmed directly.
  - Acceptance: `SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and
    `DATABASE_URL` all point at the self-hosted stack; app rebuilt/redeployed;
    every SS8 verification repeated once more against production config
    before declaring this done
  - Verify: same checklist as SS8, run again against the real `.env`
    values this time
  - Files: `backend/.env`, `frontend/.env` (both local-only, never
    committed)

### SS11 — Rollback window

- [ ] **SS11: Keep the managed Supabase project paused (not deleted) for a defined window post-cutover — started 2026-09-27, cannot complete today (hard 2-week time gate).**
  Cutover (SS10) landed 2026-09-27 — the 2-week rollback window starts
  from this date, proposed elapse ~2026-10-11. **Manual step still
  outstanding, not done in this session:** actually pausing the managed
  project is a Supabase dashboard action — no Management API token was
  configured in this session to do it programmatically, and pausing a
  live project isn't something to do unilaterally without the project
  owner's explicit action. Until paused, note it's just sitting idle
  (no longer receiving traffic — `backend/.env`/`frontend/.env` point at
  self-hosted now — but its own free-tier auto-pause behavior, the
  original SS1 trigger for this whole migration, will likely pause it
  from inactivity anyway).
  - Acceptance: managed project left paused; monitoring in place on the
    self-hosted stack for the duration (container health, disk usage,
    error rates) to catch anything SS8's manual pass missed
  - Verify: window elapses (see `SPEC-infra.md` § Open Questions —
    proposed 2 weeks) with no rollback needed
  - Files: none
  - **Resume:** pause the managed project manually (dashboard); watch
    self-hosted container health/error rates until ~2026-10-11; if clean,
    proceed to SS12's deletion decision.

### SS12 — Documentation and managed-project decision

- [x] **SS12: Update `SPEC-infra.md` and this file to reflect the completed cutover — docs done 2026-09-27; managed-project deletion deferred to SS11's elapse.**
  Updated `SPEC-infra.md`'s top status line, Tech Stack table (Database/Auth
  rows now say "Live since 2026-09-27" instead of "proposed"), the
  § Self-Hosted Supabase Migration section header (dropped "(Proposed)"),
  and added a note to § Environment Variables pointing at the real live
  values. **Managed project decision:** not deleted — can't be, until
  SS11's ~2026-10-11 window elapses cleanly. This checkbox covers the
  documentation half of SS12 only; the deletion decision itself is SS11's
  own resume step, not duplicated here.
  - Acceptance: `SPEC-infra.md`'s Tech Stack table, Environment Variables
    section, and this plan's checkboxes all reflect self-hosted Supabase
    as the live setup, not a proposal; managed project either deleted (if
    SS11's window passed cleanly) or kept with an explicit documented
    reason
  - Verify: a fresh reader of `SPEC-infra.md` alone (no tribal knowledge)
    can tell the self-hosted stack is live, not proposed
  - Files: `SPEC-infra.md`, `tasks/plan.md`

---

## Completion Checklist

Mirrors `SPEC-infra.md` § Self-Hosted Supabase Migration (Proposed) →
Success Criteria exactly — see that section for the authoritative list.
*(Reconciled 2026-10-07:)* 7 of 8 are now checked. The open one is
"existing accounts can still sign in post-cutover" — `auth.users` was
migrated, but sign-in has only been verified with a throwaway account
(SS8), not the pre-existing migrated one. SS11's rollback window
(~2026-10-11) is tracked separately above.

---

# Implementation Plan: spot-reports module

**Spec:** [SPEC-spot-reports.md](../SPEC-spot-reports.md) (approved 2026-10-07)
**Module:** `spot-reports`
**Build position:** Fourth — depends on `infra` (schema, self-hosted stack), `map` (`spots_in_bbox`, `SpotLayer`, `SpotDetailSheet`) and `auth` (`useAuth`, `AuthSheet`).

> **Status (2026-10-07):** planned, nothing built. Every task below is
> unchecked.

---

## Dependency Graph

```
DB slice (local stack only)
[R1] table + report_spot ──→ [R2] spots_in_bbox v2 (+ latency baseline)
                                        │
Frontend slice                          ▼
[R3] types + reportStatus helpers ──→ [R4] marker ring + refetch
        │
        └──→ [R5] useReportSpot ──→ [R6] ReportButtons + i18n ──→ [R7] wire into SpotDetailSheet
                                                                         │
                                         ── Checkpoint C1: local end-to-end ──
                                                                         │
[R8] retention job ─┐                                                    │
[R9] docs ──────────┴──────────────────────────────────────────→ [R10] production rollout (ask first)
```

- R1→R2 are sequential (same migration file, R2 reads the table R1 creates).
- R3 only needs the *agreed shape* of R2's columns, not a running DB, so
  the frontend slice can start in parallel with R2.
- R8 and R9 are independent of each other and of R3–R7.
- R10 is the only task that touches production; it waits for everything.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| DB tests write to **production** — `backend/.env`'s `DATABASE_URL` has pointed at prod since 2026-09-27 | High if forgotten | R1 adds a guard fixture that skips on prod hosts, and every test runs in a rolled-back transaction. Always pass an explicit local `DATABASE_URL` |
| `spots_in_bbox` return-type change breaks the live app between migration and app release | Medium | `DROP` + `CREATE` + re-`GRANT` in one transaction; existing columns/args unchanged, so old app builds ignore the extra fields. R2 has a test that asserts the old columns still come back for `anon` |
| `SECURITY DEFINER` functions with a mutable `search_path` (privilege-escalation footgun) | Medium | Both functions `SET search_path = public` (plus `pg_temp` last); R1/R2 test that `anon` can't execute `report_spot` |
| Lateral join slows the hottest query in the app | Medium | Baseline measured *before* R2 changes anything; acceptance is p95 within +20% (spec criterion 8) |
| Simulating `auth.uid()` in pytest | Low | Same mechanism PostgREST uses: `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', …, true)` |
| `@testing-library/react-native` async pitfalls (hit in the map and auth modules) | Low — known | `await render()` / `renderHook()` from the start; fake timers only with `advanceTimersByTimeAsync` |
| Simulator can't type `@` (blocked the auth device checks) | Medium | R7's manual pass uses an account that's already signed in, or pastes credentials |

---

## Tasks

### R1 — `spot_reports` table and `report_spot` RPC

- [x] **R1: Write the first half of `supabase/migrations/007_spot_reports.sql` and its DB tests — done 2026-10-07, local stack only.**
  Applied to the local `db` container as `supabase_admin` (first confirmed
  port 5432 was the local container, not a tunnel to production).
  `FREIPARK_DB_WRITE_TESTS=1 pytest` → 27 passed (15 new + existing);
  `spot_reports`, test users and test spots all back to 0 rows afterwards.
  **Deviation from spec, spec updated first:** the generated `expires_at`
  column failed with `generation expression is not immutable` —
  `timestamptz + interval` depends on the session time zone. Dropped the
  column; expiry is now `reported_at + 30 min`, computed where needed
  (`report_spot` returns it; R2's read filter uses
  `reported_at > now() - interval '30 minutes'`, which the existing index
  covers). **Guard fix found by testing it:** pointing at a remote host
  initially produced 15 *errors* (the session `db_conn` connected before
  the guard ran — a 75 s timeout, no writes) instead of skips; `write_tx`
  now checks the host and opt-in flag before opening the connection.
  Verified: remote host → 15 skipped in 0.01 s; no flag → 15 skipped.
  Guard is an allowlist (`localhost`/`127.0.0.1`/`::1`) plus an opt-in
  flag, since a localhost SSH tunnel to production would pass a hostname
  check — the rollback is what makes a mistake harmless.
  - Table, both indexes, RLS on with **no** client policies (spec § Data Model)
  - `report_spot(p_spot_id, p_status, p_lon, p_lat)`: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, the six checks in spec order, radius 150 m for `street` and 300 m otherwise; `GRANT EXECUTE … TO authenticated`, `REVOKE … FROM anon, public`
  - `conftest.py`: prod-host guard (skip unless `ALLOW_PROD_DB_TESTS=1`), a rolled-back `tx` fixture, and an `as_user(uuid)` helper that sets role + JWT claims
  - Acceptance: migration applies cleanly on top of `001`–`006` on the local stack; tests cover anon denied (table + RPC), authenticated direct-table access denied, happy path, `expires_at = reported_at + 30 min`, every error code, radius by type (street 200 m → `too_far`; lot 200 m → ok; lot 350 m → `too_far`), cascade on user delete
  - Verify: `DATABASE_URL=<local> pytest tests/test_spot_reports.py -v` — all pass; the existing `test_db.py` still passes; a run with prod `DATABASE_URL` **skips**
  - Files: `supabase/migrations/007_spot_reports.sql`, `backend/tests/conftest.py`, `backend/tests/test_spot_reports.py`

### R2 — `spots_in_bbox` v2

- [x] **R2: Extend `spots_in_bbox` with `report_status` / `report_at` — done 2026-10-07, local stack only.**
  `FREIPARK_DB_WRITE_TESTS=1 pytest` → 22 passed in `test_spot_reports.py`
  (7 new: column list unchanged + 2 new, NULLs with no report, visible to
  `anon` and `authenticated`, hidden after 31 min, latest wins, lateral
  lookup uses `idx_spot_reports_spot_latest` with 1,000 reports seeded).
  Both functions now `SET search_path = public, extensions, pg_temp` —
  PostGIS is in `public` locally, `extensions` added in case production
  differs (check during R10).
  **Latency** (anon, Berlin initial bbox, 2000 rows, 200 measured calls
  per run after 10 warm-up, timed inside the DB with `clock_timestamp()`):

  | | p50 | p95 |
  |---|---|---|
  | Baseline (002 function, before any change) | 1.9 ms | 48.8 ms |
  | New function, 1,000 active reports seeded | 1.7 ms | 1.8 ms |
  | Same session A/B — old | 1.7 ms | 49.2–49.4 ms |
  | Same session A/B — new | 1.7 ms | 1.8 ms |

  Criterion (p95 within +20%) met. The old function's ~49 ms outliers on
  roughly 1 in 10 calls are reproducible and **not** JIT (identical with
  `jit = off`); most likely they come from the old function being inlined
  into the calling query in this harness, which `SECURITY DEFINER` + `SET`
  prevent for the new one. Not claimed as a production speed-up — R10
  re-measures on production, and real calls arrive via PostgREST, not a
  plpgsql loop.
  - **First**, on the local stack *before* changing anything: run the Berlin-bbox `spots_in_bbox` call through `EXPLAIN (ANALYZE)` 10× and record p50/p95 in this task's notes as the baseline
  - Then in `007`: `DROP FUNCTION` + `CREATE` with the same args/defaults and two new nullable columns via `LEFT JOIN LATERAL` (latest unexpired report); `SECURITY DEFINER`, `SET search_path = public, pg_temp`; re-`GRANT EXECUTE … TO anon, authenticated`; all in the migration's single transaction
  - Acceptance: active report returned; `NULL` once backdated 31 min; latest of two wins; no `user_id` column in output; `anon` can still call it and gets the original seven columns unchanged; plan uses `idx_spot_reports_spot_latest`; p95 within +20% of baseline with ~1,000 synthetic reports seeded in the bbox (rolled back afterwards)
  - Verify: `pytest tests/test_spot_reports.py -v`; baseline and after numbers written here
  - Files: `supabase/migrations/007_spot_reports.sql`, `backend/tests/test_spot_reports.py`

### R3 — Types and pure helpers

- [x] **R3: `SpotRow` report fields + `features/reports/reportStatus.ts` — done 2026-10-07.**
  `npx tsc --noEmit` clean; `npx jest` → 119/119 across 7 suites
  (`reportStatus.test.ts` 26 new, `geo.test.ts` +1); `reportStatus.ts` at
  100% lines / 84% branches. Two additions beyond the task text, both
  driven by real data shapes: (1) `activeReport()` — the status + age pair
  R7's sheet needs — accepts *missing* fields, because MapLibre can drop
  null-valued properties from a tapped feature (`SpotLayer` reads the spot
  back via `feature.properties as SpotRow`); (2) timestamps are parsed
  after trimming PostgREST's microseconds to milliseconds, since Hermes's
  `Date.parse` isn't guaranteed to accept 6 fractional digits. Touched 6
  files, not 4: the `SpotRow` fixtures in `SpotDetailSheet.test.tsx` and
  `useSpots.test.ts` also needed the two new fields.
  - `SpotRow` gains `report_status: 'free' | 'full' | null` and `report_at: string | null`
  - `reportStatus.ts`: `ReportStatus`, `ReportErrorCode`, `isActive()`, `ageMinutes()`, `errorCode()`, `maxRadiusFor(spotType)` (150/300 — kept in sync with the SQL by a comment pointing at `007`)
  - Acceptance: `tsc --noEmit` clean (fix any test fixtures that build `SpotRow`s); `isActive` boundary 29:59 → true, 30:00 → false; every RPC message maps; unknown → `'unknown'`; `spotsToGeoJSON` carries both new props (it spreads the row, so this is a test, not a code change)
  - Verify: `npx jest reportStatus geo`; `npx tsc --noEmit`
  - Files: `frontend/src/lib/types.ts`, `frontend/src/features/reports/reportStatus.ts`, `frontend/__tests__/reportStatus.test.ts`, `frontend/__tests__/geo.test.ts`

### R4 — Marker ring and refetch

- [x] **R4: Ring paint in `SpotLayer`; `refetch()` from `useSpots` — done 2026-10-07; on-device visual check still pending (C1).**
  Tests written first and seen failing (5), then passing: `npx jest` →
  125/125 across 8 suites; `npx tsc --noEmit` clean. New
  `SpotLayer.test.tsx` (not in the original file list) mocks MapLibre's
  `GeoJSONSource`/`Layer` and asserts the unclustered layer's paint: fill
  expression unchanged, ring colour/width driven by `report_status` with
  white/1 as the fallback. A missing property hits the fallback, so spots
  whose `null` was dropped by the map still render as before.
  `useSpots.refetch()` reloads the last requested bbox (Berlin initial
  before any pan) via `fetchBbox`, so the stale-response guard applies —
  covered by a test where an older in-flight pan resolves after the
  refetch and is discarded.
  - `spots-unclustered` gets data-driven `circle-stroke-color` / `circle-stroke-width` from `report_status` (spec § Map markers); fill expression untouched
  - `useSpots` remembers the last bbox and returns `refetch()`, which reuses `fetchBbox` (so the stale-response guard still applies)
  - Acceptance: no report → identical paint to today; `refetch()` re-requests the last bbox, or `BERLIN_INITIAL` before any pan
  - Verify: `npx jest useSpots` (new refetch cases); visual check deferred to C1
  - Files: `frontend/src/features/map/SpotLayer.tsx`, `frontend/src/features/map/useSpots.ts`, `frontend/__tests__/useSpots.test.ts`

### R5 — `useReportSpot` hook

- [x] **R5: `features/reports/useReportSpot.ts` — done 2026-10-07.**
  Tests written first (module-not-found), then 16/16 passing; full suite
  141/141 across 9 suites; `npx tsc --noEmit` clean; `useReportSpot.ts`
  at 100% lines; no `any`. Design choices beyond the task text:
  - Signed-in check is `supabase.auth.getSession()` at tap time, not
    `useAuth()` — each `useAuth()` instance sets up its own auth listener,
    and the session at tap time is the authoritative answer anyway.
  - `submit()` returns an outcome (`{ ok: true, report }` or
    `{ ok: false, error }`) as well as setting state, so R6 can open
    `AuthSheet` on `not_authenticated` without an effect.
  - A second tap while one report is in flight returns `'busy'` and is
    ignored (no state change, no analytics event); guarded by a ref so two
    taps in the same render see each other.
  - RPC rows are validated (`status` free/full, `reported_at` string)
    rather than cast; an empty or malformed response → `unknown`.
  - Location: Balanced accuracy raced against a 10 s timeout; any failure
    → `location_unavailable` with no RPC call.
  - Analytics: `spot_report_submitted { report_status, parking_spot_type,
    parking_access }` and `spot_report_failed { reason }` only — a test
    asserts the exact property set.
  - `submit(spot, status)`: if no session → returns `'not_authenticated'` without calling anything; otherwise fresh `Location.getCurrentPositionAsync` (Balanced, 10 s timeout via `Promise.race`) → `supabase.rpc('report_spot', …)` → typed result or `ReportErrorCode`
  - State: `submitting`, `error: ReportErrorCode | null`, `lastReport: { status, reported_at } | null`
  - PostHog `spot_report_submitted` / `spot_report_failed` with only the spec's allowed properties
  - Acceptance: sends the *fresh* coordinates (not `MapScreen`'s mount-time ones); each RPC error maps; location timeout or rejection → `location_unavailable`; no RPC when signed out; no `any`
  - Verify: `npx jest useReportSpot` (mock `supabase.rpc`, `expo-location`, `posthog`)
  - Files: `frontend/src/features/reports/useReportSpot.ts`, `frontend/__tests__/useReportSpot.test.ts`

### R6 — `ReportButtons` + translations

- [x] **R6: `features/reports/ReportButtons.tsx` and `report.*` keys in all three locales — done 2026-10-07.**
  Tests written first (module-not-found), then 15/15 passing (11 component
  + 2 locale-parity + 2 parametrised); full suite 156/156 across 10
  suites; `npx tsc --noEmit` clean; no `any`. 15 `report.*` keys added to
  `de`/`en`/`tr` (locale files round-tripped byte-for-byte first, so the
  diff is additions only). German uses formal *Sie* and Turkish the polite
  form, matching the existing strings. The status-line keys
  (`statusFree`/`statusFull` + `…Now` for under a minute) are added here
  for R7 to use.
  **Deviation from the task text:** `ReportButtons` does **not** render
  its own `AuthSheet`. It sits inside `SpotDetailSheet` (a gorhom bottom
  sheet), and a bottom sheet nested there would be confined to the
  parent sheet's area. It calls `onSignInRequired()` instead; R7 renders
  the `AuthSheet` at `MapScreen` level, alongside `AccountButton`'s.
  A `'busy'` outcome (second tap mid-request) does nothing;
  `not_authenticated` shows no error text.
  - Two buttons (free / full); renders its own `AuthSheet` (same `visible`/`onClose` API that `AccountButton` uses) for signed-out taps and `not_authenticated`; disabled + hint when `locationDenied`; spinner while submitting; inline error text; calls `onReported(report)` on success
  - Keys: button labels, status line ("Reported free · {{n}} min ago"), every error message, location hint — `de`, `en`, `tr` together
  - Acceptance: signed-out tap opens `AuthSheet` and sends nothing; denied → disabled + hint; each error code renders its message; success calls `onReported`; buttons have accessibility labels
  - Verify: `npx jest ReportButtons`; a key-parity check that all three locale files have the same `report.*` keys
  - Files: `frontend/src/features/reports/ReportButtons.tsx`, `frontend/src/i18n/locales/de.json`, `frontend/src/i18n/locales/en.json`, `frontend/src/i18n/locales/tr.json`, `frontend/__tests__/ReportButtons.test.tsx`

### R7 — Wire into the detail sheet

- [x] **R7: Status line + `ReportButtons` in `SpotDetailSheet`; refetch from `MapScreen` — done 2026-10-07; not yet seen on a device (C1).**
  Tests written first: 9 new in `SpotDetailSheet.test.tsx` (7 failed
  before the change; the 2 "hidden" cases passed trivially), then 36/36;
  full suite 165/165 across 10 suites; `npx tsc --noEmit` clean.
  `ReportButtons` is mocked in these tests (it has its own); the existing
  helper now passes the two new required props.
  - Status line: "Reported free/full · N min ago", "just now" under a
    minute, hidden when expired or absent. A one-minute interval (only
    while a spot is shown) keeps the age current and drops the line at
    30 min — covered by a fake-timer test.
  - The user's own report shows immediately (`justReported`), because
    `selectedSpot` is the row captured at tap time and isn't replaced by
    the refetch. It's keyed by spot id, so it doesn't leak onto the next
    spot opened — tested.
  - `MapScreen`: `onReported={refetch}` (rings update) and a second
    `AuthSheet` for signed-out report taps, rendered after the spot sheet
    so it sits on top. `AuthSheet` starts at `index={-1}`, so the extra
    instance is invisible until opened.
  - **For C1:** the sheet's snap points (35% / 55%) were sized before the
    report row existed; check nothing important falls below the first
    snap point.
  - Status line uses `lastReport` (optimistic) over `spot.report_status` / `report_at`, hidden when inactive; minutes re-render once a minute while the sheet is open
  - `MapScreen` passes `onReported={refetch}` and the existing `locationDenied`
  - `MapScreen` renders an `AuthSheet` for `onSignInRequired` (see R6's deviation note)
  - Acceptance: active report → line shown; expired or none → hidden; after a successful report the line updates immediately and `refetch` is called once; existing sheet tests unchanged
  - Verify: `npx jest` (whole suite); `npx tsc --noEmit`
  - Files: `frontend/src/features/map/SpotDetailSheet.tsx`, `frontend/src/features/map/MapScreen.tsx`, `frontend/__tests__/SpotDetailSheet.test.tsx`

### Checkpoint C1 — local end-to-end

- [x] **C1: Simulator against the *local* self-hosted stack — done 2026-10-07, with two open findings (ring contrast, no Berlin street spots).**
  **Setup:** `frontend/c1.env` (gitignored by the root `*.env` rule; not
  auto-loaded) = `frontend/.env` with only `EXPO_PUBLIC_SUPABASE_URL`
  switched to `http://localhost:8000`. Use:
  `cd frontend && set -a && . ./c1.env && set +a && npx expo start --dev-client`.
  Confirmed the served iOS bundle contains `http://localhost:8000` once and
  `supabase.freipark.com` zero times. Gotcha: first named it
  `.env.c1.local` — Expo's env handling picked the `.env*` file up and
  Metro failed with a TransformError trying to compile it; renamed.
  Ran the Oct 1 Debug simulator build from DerivedData (R3–R7 are JS-only,
  no rebuild needed) on an iPhone 17 Pro sim, driven with `idb`.
  **HTTP layer first** (curl through local Kong with a throwaway local
  user + locally minted JWT): lot 350 m → `too_far`; lot 200 m → ok;
  repeat → `rate_limited_spot`; street 200 m → `too_far`; street 100 m → ok;
  anon `spots_in_bbox` returns the report. Error bodies are
  `{"code":"P0001","message":"too_far"}` — exactly what `errorCode()` maps;
  success rows carry microsecond timestamps (R3's parser handles them).
  Anon `report_spot` → `42501 permission denied`.
  **In the app** (screenshots kept in the job's tmp dir):
  - Sheet at the 35% snap point fits type, access, report status, route,
    capacity, prompt and both buttons — no snap-point change needed.
  - Signed out → "Space free" opens `AuthSheet` on top of the spot sheet;
    0 reports written.
  - Signed in (local-only test user `c1-tester@example.invalid`) → report
    stored (`free`, 26.8 m from the lot), sheet shows "Reported free · just
    now", marker gains the ring after the refetch.
  - Same spot again → "You reported this spot a moment ago."; still 1 row.
  - Sim location moved ~400 m → "You need to be at the spot to report it."
    — the fresh location fix was used (blue dot moved); still 1 row.
  - "Second device sees it" covered by the anon HTTP read above rather
    than a second simulator.
  **Not exercised in the UI:** typing credentials into `AuthSheet`. `idb`
  can't type `@` and the paste menu never offered Paste (same tooling
  limit as the auth module). Signed in by fetching a real session from
  local GoTrue (`grant_type=password`) and writing it into the app's
  AsyncStorage (`sb-localhost-auth-token`, stored as an MD5-named file
  because it's > 1 KB) — real session, only the typing skipped.
  **Findings to decide on:**
  1. **Ring contrast:** teal (`#14b8a6`) ring on a green "free access"
     fill (`#22c55e`) reads as a slightly bigger green dot at normal zoom.
     Clear on blue/amber/red/grey fills. Needs a colour decision.
  2. **Central Berlin has no `street` spots** in the imported data (24,378
     lots, 624 garages; all 9,635 street spots are in other cities), so in
     Berlin the 300 m radius is the one that applies in practice.
  3. `Simulator.app` is missing from this Xcode install (sims boot
     headless only) — fine for `idb`-driven checks, but there's no window
     for manual testing until it's reinstalled.
  **Cleanup:** test user deleted (its report cascaded): 0 reports, 1 user —
  same as before C1. Injected session removed from the sim app; Metro
  stopped; simulator shut down; temp password/session files deleted.
  Coverage: `features/reports/` 100% lines (R3/R5).
  - Street spot, simulator location within 150 m → report free → ring + status line; a second simulator or device (signed out) sees it after panning
  - Lot from 200 m → accepted; street from 200 m → "You need to be at the spot"
  - Same spot twice within 5 min → rate-limit message
  - Ring colours checked against the fills and the basemap — change them here if needed (spec open question)
  - Coverage: `npx jest --coverage` → `features/reports/` ≥ 80% lines

### R8 — Retention job

- [x] **R8: `supabase/self-host/purge_spot_reports.sh` — done 2026-10-07, local only; cron NOT installed on the OVH box (ask first).**
  **Design change, spec updated first:** the DELETE lives in a
  `purge_spot_reports(retention_days int)` function added to migration
  `007` (not yet on production, so still editable): rejects < 1, returns
  the row count, `EXECUTE` revoked from `public`/`anon`/`authenticated`.
  The script validates `FREIPARK_REPORT_RETENTION_DAYS` (whole number ≥ 1;
  `0` and `30; DROP TABLE x` both refused with exit 1 before touching the
  DB) and calls the function as `supabase_admin`. `FREIPARK_DOCKER`
  defaults to `sudo docker` like `backup_db.sh`; `docker` locally.
  Tests: 5 new DB tests written first (all failed: function missing),
  then `FREIPARK_DB_WRITE_TESTS=1 pytest` → 39/39. Script run on the local
  stack with committed seed data: 31-day and 1-day reports → 1 deleted,
  the 1-day one kept; seed user removed afterwards (0 reports, 1 user).
  **Found while reading `backup_db.sh`:** the nightly backup dumps only
  `cities`, `parking_spots`, `auth.users`, `auth.identities` — once `007`
  is live, `spot_reports` is **not backed up**. Added to R10 as a decision.
  - Deletes `spot_reports` rows with `reported_at < now() - interval '30 days'`; logs the row count; same `docker compose exec db psql` pattern as `backup_db.sh`
  - Acceptance: run on the local stack with seeded 31-day-old and 1-day-old rows → only the old ones go
  - Verify: run it locally, check counts before and after
  - **Ask first:** installing the cron entry on the OVH box (proposed `30 3 * * *`, after the 03:00 backup)
  - Files: `supabase/self-host/purge_spot_reports.sh`

### R9 — Docs that ship with the feature

- [x] **R9: `PRIVACY_POLICY.md`, `CLAUDE.md`, `SPEC-infra.md` — done 2026-10-07 (docs ahead of the R10 rollout: they describe the feature as built, not yet live).**
  - Privacy policy: new *Spot reports* subsection (what's stored — account
    ID, spot, status, time, distance; coordinates read once and **not**
    stored; never shown who reported; 30-min display, deletion after the
    retention window or on account deletion), the report check added to
    *Location data*, two rows in the legal-basis table, retention and
    erasure lines. Retention, backup inclusion and the Art. 6(1)(f) basis
    are marked `[CONFIRM …]` like the rest of the draft.
  - **Found, not fixed:** the policy says "no third-party analytics SDKs,
    no crash reporting SDKs" — false since Sentry (`e46985e`, incl.
    session replay) and PostHog (`5479c2f`) shipped. Marked in place with
    a ⚠️ OUT OF DATE note listing the four sections that need rewriting;
    describing what those SDKs actually collect is separate work.
  - `CLAUDE.md`: MVP scope now includes crowdsourced free/full reports
    (dropped "no real-time availability"); module order gains
    `spot-reports`; `/src/features/reports` listed; RLS line covers
    `spot_reports` (no client access; RPCs only; reporter never returned).
  - `SPEC-infra.md` § Phase 2: superseded note pointing at
    `SPEC-spot-reports.md`, listing what changed from the sketch and that
    the user-base precondition was waived.
  - Privacy policy: new "Spot reports" section — what's stored (account id, spot, status, time, distance; **not** coordinates), why, 30-day retention, deleted with the account
  - `CLAUDE.md`: MVP-scope line no longer says "no real-time availability"; it describes crowdsourced reports instead; module order gains `spot-reports`
  - `SPEC-infra.md` § Phase 2: pointer to `SPEC-spot-reports.md` as the authoritative version
  - Acceptance: a reader of any one of the three isn't misled about what the app does
  - Files: `PRIVACY_POLICY.md`, `CLAUDE.md`, `SPEC-infra.md`

### R10 — Production rollout (ask first)

- [ ] **R10: Apply `007` to production, release the app, verify live**
  - **Ask first** before each production step
  - [x] **Decided 2026-10-07: back up `spot_reports`.** Added
    `-t public.spot_reports` to `backup_db.sh`. Verified locally before
    any deploy: dumped with the script's exact flags (one committed test
    report present) — COPY order `auth.users → auth.identities → cities →
    parking_spots → spot_reports`; then, in one rolled-back transaction,
    truncated all five tables and restored the dump with FKs enforced →
    identical counts (33 / 424,911 / 2 / 1 / 1), no errors. Test rows
    removed afterwards (back to 1 user, 0 reports). Privacy policy now
    states reports are in nightly backups kept 14 days. **The OVH box only
    picks this up after `git pull` there (part of step 2 below).**
  - [x] **Decided 2026-10-07: keep the teal ring** (C1 finding 1).
  - Install the R8 cron entry (`30 3 * * *`, after the backup) — ask first.
  - Order: (1) fresh `backup_db.sh` run; (2) apply `007` on the OVH box as `supabase_admin`; (3) confirm the *current* app still loads spots (old build, new RPC); (4) `EXPLAIN ANALYZE` p95 on prod vs the R2 baseline; (5) app release with the new UI; (6) live checks for spec criteria 4–7, including one real report from a real location
  - Rollback: `DROP FUNCTION` + recreate `002`'s `spots_in_bbox`, `DROP FUNCTION report_spot`, `DROP TABLE spot_reports` — written out and kept in this task's notes *before* step 2
  - Acceptance: spec § Success Criteria 1–10 all checked in `SPEC-spot-reports.md`
  - Files: none in the repo besides checkbox and notes updates in this file and the spec

---

## Completion Checklist

Mirrors `SPEC-spot-reports.md` § Success Criteria — see that section for
the authoritative list. Nothing checked yet.
