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

**Spec:** [SPEC-auth.md](../SPEC-auth.md) § Phone auth (OTP), § Dashboard Configuration; [SPEC-infra.md](../SPEC-infra.md) § Verifying Supabase JWTs (Future)
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
- [ ] **Outstanding — not something this environment can do:** actually
  uploading the 768 glyph files to the project's real Cloudflare R2
  bucket and setting `EXPO_PUBLIC_GLYPHS_URL` in the real
  `frontend/.env`. No Cloudflare credentials, `wrangler`, `rclone`, or
  `aws` CLI available here.
- [x] **Cleanup:** the throwaway local HTTP server and temporary
  `EXPO_PUBLIC_GLYPHS_URL` test value were removed after the first
  verification pass; `frontend/.env` is back to its pre-test state;
  Metro was restarted clean. The stale app session that surfaced the
  scope-correction error above was a leftover from *before* that
  cleanup — not a new regression.
