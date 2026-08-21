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
