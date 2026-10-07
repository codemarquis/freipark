# Spec: spot-reports — Crowdsourced "free / full" reports

**Module:** `spot-reports`
**Capability map:** [CLAUDE.md](CLAUDE.md) → module order `infra → map → auth → spot-reports`. Depends on `infra` (schema, RLS), `map` (`spots_in_bbox`, `SpotLayer`, `SpotDetailSheet`) and `auth` (`useAuth`, `AuthSheet`). This is Phase 2 from `SPEC-infra.md` § Phase 2: Manual Crowdsourced Reports — this spec supersedes that section's schema sketch.
**Status:** Approved 2026-10-07 — next step is the task breakdown in `tasks/plan.md`.

> **Scope decision (2026-10-07):** approved despite `CLAUDE.md`'s "no
> real-time availability" MVP rule and `SPEC-infra.md`'s "small active
> user base first" precondition. Short-lived reports are only useful at
> some density of reporters; that risk is accepted. `CLAUDE.md`'s
> MVP-scope line is updated in the same change that ships the module.

---

## Objective

Let a signed-in driver who is **at** a parking spot tell other drivers
whether there is space there right now. Other users — signed in or not —
see that report on the map and in the spot's detail sheet until it
expires 30 minutes later.

**User stories**

- *Reporter:* I parked (or saw the lot was full). I tap the spot, tap
  **"Space free"** or **"Full"**, and I'm done in under 3 seconds.
- *Searcher:* I'm looking for parking. Markers with a fresh report stand
  out; tapping one says "Reported free · 4 min ago".
- *Signed-out user:* I see reports like everyone else. Tapping a report
  button asks me to sign in (existing `AuthSheet`) — browsing never
  requires an account.

**Decided (2026-10-07):**

| Decision | Choice |
|---|---|
| Report vocabulary | `free` / `full` for **every** spot type (street, lot, garage, zone). "Taken" was dropped — it's ambiguous for a 200-space lot. |
| Lifetime | 30 minutes from `reported_at`, all spot types |
| Display | Detail-sheet status line **and** a marker ring on spots with an active report |
| Anti-abuse | DB-enforced rate limits **and** a proximity check against the reporter's device location: 150 m for `street`, 300 m for `lot` / `garage` / `zone` (their centroid can be far from the entrance) |
| Conflict rule | Latest unexpired report wins |

**Not this module's job:** user-submitted *new* spots (`source = 'manual'`),
reputation/karma, push notifications, report history UI, aggregating
reports into clusters, real-time push (Realtime is deliberately not
deployed — see `SPEC-infra.md`). No FastAPI changes: per `SPEC-infra.md`
§ Verifying Supabase JWTs, the client calls Supabase directly and
Postgres (RLS + `auth.uid()`) enforces who can write.

---

## Tech Stack

No new dependencies.

| Concern | Choice |
|---|---|
| Storage + rules | Postgres 15 / PostGIS on the self-hosted stack — one new table, two RPCs |
| Write path | `supabase.rpc('report_spot', …)` from the client with the user's session token |
| Read path | Existing `spots_in_bbox` RPC, extended with two nullable columns |
| Location | `expo-location` (already used by `MapScreen`) — **fresh fix at submit time**, not the one-shot `userLocation` captured at mount |
| UI | `@gorhom/bottom-sheet` (existing `SpotDetailSheet`), MapLibre circle layer (existing `SpotLayer`) |
| i18n | `react-i18next`, keys added to `de.json` / `en.json` / `tr.json` |
| Analytics | PostHog (existing) — no coordinates or user ids in event properties |

---

## Commands

```bash
# Apply migration to the LOCAL self-hosted stack first (never prod first)
docker compose up -d db auth rest kong
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  < supabase/migrations/007_spot_reports.sql

# Backend DB tests — against the local stack only (see § Testing Strategy)
cd backend && DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/postgres \
  pytest tests/test_spot_reports.py -v

# Frontend
cd frontend && npx jest
cd frontend && npx tsc --noEmit
cd frontend && npx expo start
```

---

## Data Model

### Migration `supabase/migrations/007_spot_reports.sql`

```sql
CREATE TABLE spot_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id     UUID        NOT NULL REFERENCES parking_spots(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('free', 'full')),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  distance_m  REAL        NOT NULL   -- reporter→spot distance at submit time; audit only
);
-- Expiry is derived, never stored: a report is active while
-- reported_at > now() - interval '30 minutes'.

-- Latest report per spot (read path) and per-user rate limits (write path)
CREATE INDEX idx_spot_reports_spot_latest ON spot_reports (spot_id, reported_at DESC);
CREATE INDEX idx_spot_reports_user_recent ON spot_reports (user_id, reported_at DESC);

ALTER TABLE spot_reports ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: the table is not directly readable
-- or writable by clients. All access goes through the two SECURITY DEFINER
-- functions below, which never return user_id.
```

**Differences from the `SPEC-infra.md` Phase 2 sketch, and why:**

- `'taken'` → `'full'` (decided above).
- No `expires_at` column: expiry is computed as `reported_at + 30 min`
  wherever it's needed, so it can't drift from `reported_at` and clients
  can't extend a report's lifetime. *(Changed during R1, 2026-10-07: a
  generated `timestamptz + interval` column is rejected by Postgres as
  "generation expression is not immutable", because that addition depends
  on the session time zone.)*
- Reporter **coordinates are not stored**, only `distance_m`. That's enough
  to audit the proximity check without keeping a location trail per user
  (data minimisation; see § Privacy).
- No direct-table RLS policies: exposing rows would leak `user_id` (who
  reported where, when). Reads return aggregates only.

Account deletion (`DELETE /account`) already removes the `auth.users` row;
`ON DELETE CASCADE` removes that user's reports with it.

### Write RPC: `report_spot`

```sql
report_spot(p_spot_id uuid, p_status text, p_lon float8, p_lat float8)
  RETURNS TABLE (status text, reported_at timestamptz, expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- GRANT EXECUTE … TO authenticated;  REVOKE … FROM anon, public;
```

Checks, in this order, each raising a distinct, stable error the client maps to a message:

| # | Check | Error (`RAISE … USING MESSAGE`) |
|---|---|---|
| 1 | `auth.uid()` is not null | `not_authenticated` |
| 2 | `p_status IN ('free','full')` | `invalid_status` |
| 3 | spot exists | `spot_not_found` |
| 4 | `ST_Distance(spot.location::geography, point::geography) ≤ max_m`, where `max_m = 150` for `spot_type = 'street'`, `300` otherwise | `too_far` |
| 5 | no report by this user **for this spot** in the last 5 min | `rate_limited_spot` |
| 6 | < 20 reports by this user in the last 60 min | `rate_limited_hourly` |

On success: insert, return the new row's public fields. The proximity check
uses the spot's `location` (centroid); the larger 300 m radius for
lots/garages/zones covers centroids that sit far from where a driver stands.

**Honest limitation:** the device location is client-asserted and
spoofable. The check stops casual/armchair spam, not a determined attacker.

### Read path: `spots_in_bbox` gains two columns

```sql
-- additional output columns
report_status text,          -- 'free' | 'full' | NULL (no active report)
report_at     timestamptz    -- reported_at of that report, NULL if none
```

Implemented as a `LEFT JOIN LATERAL (… WHERE r.spot_id = ps.id AND
r.reported_at > now() - interval '30 minutes' ORDER BY r.reported_at DESC
LIMIT 1)` — both conditions are covered by `idx_spot_reports_spot_latest`.

- Changing a function's return type requires `DROP FUNCTION` + `CREATE`
  (not `CREATE OR REPLACE`), and the `GRANT EXECUTE … TO anon, authenticated`
  must be re-issued — the migration does both in one transaction.
- The function becomes `SECURITY DEFINER` (it now reads `spot_reports`,
  which has no client policies) with `SET search_path = public`. It still
  never returns `user_id`.
- Existing columns, argument names and defaults are unchanged, so current
  app builds keep working (extra JSON fields are ignored).

---

## Project Structure

```
supabase/migrations/007_spot_reports.sql        # table, indexes, RLS, report_spot, spots_in_bbox v2, purge_spot_reports
supabase/self-host/purge_spot_reports.sh        # daily retention job (calls purge_spot_reports)
backend/tests/test_spot_reports.py              # DB-level tests (rollback-only)

frontend/src/features/reports/
  useReportSpot.ts       # gets a fresh location fix, calls report_spot, maps errors
  ReportButtons.tsx      # "Space free" / "Full" buttons + inline error/success state
  reportStatus.ts        # pure helpers: isActive(), ageMinutes(), errorCode()
frontend/src/features/map/
  SpotDetailSheet.tsx    # renders status line + <ReportButtons/>
  SpotLayer.tsx          # ring paint expression for report_status
  useSpots.ts            # exposes a refetch() so a new report shows immediately
frontend/src/lib/types.ts                       # SpotRow + report_status, report_at
frontend/src/lib/geo.ts                         # carry report props into GeoJSON features
frontend/src/i18n/locales/{de,en,tr}.json       # report.* keys
frontend/__tests__/
  useReportSpot.test.ts
  ReportButtons.test.tsx
  reportStatus.test.ts
  SpotDetailSheet.test.tsx   # extended
  geo.test.ts                # extended
PRIVACY_POLICY.md            # new section: spot reports
```

---

## UI

### Detail sheet

Below the existing type/access line:

- Active report → `Reported free · 4 min ago` / `Reported full · 12 min ago`
  (i18n, relative minutes).
- No active report → nothing (no "no reports" filler).
- Two buttons: **Space free** · **Full**.
  - Signed out → tapping opens `AuthSheet`; the report is **not** queued or
    auto-sent after sign-in (the user may have moved on).
  - Location permission denied → buttons disabled, hint "Location needed to
    report".
  - Submitting → buttons disabled + spinner; fresh `getCurrentPositionAsync`
    (Balanced accuracy, 10 s timeout).
  - Success → status line updates immediately (optimistic from the RPC
    response), then `refetch()` on the current bbox.
  - Error → inline message from the error table below; no crash, no alert
    dialog.

| RPC / client error | Message (en) |
|---|---|
| `too_far` | "You need to be at the spot to report it." |
| `rate_limited_spot` | "You reported this spot a moment ago." |
| `rate_limited_hourly` | "Too many reports — try again later." |
| `not_authenticated` | opens `AuthSheet` |
| location timeout / unavailable | "Couldn't get your location." |
| anything else | "Couldn't send report. Try again." |

### Map markers

Fill colour keeps meaning **access type** (free green, paid blue, permit
amber, private red). Reports are shown with the **ring** only, so the two
signals don't collide:

| State | `circle-stroke-color` | `circle-stroke-width` |
|---|---|---|
| no active report | `#ffffff` (unchanged) | 1 |
| `report_status = 'free'` | `#14b8a6` (teal) | 3 |
| `report_status = 'full'` | `#111827` (near-black) | 3 |

Expiry on the client: `spots_in_bbox` already filters expired reports, and
markers refresh on each pan. A report that expires while the user stares at
a static map stays visible until the next fetch — acceptable for v1. The
detail sheet recomputes "N min ago" from `report_at` and hides the line once
`now − report_at ≥ 30 min`.

Clusters are unchanged (no report aggregation).

---

## Code Style

Follow the existing feature-folder pattern. Strict TS, no `any`; RPC
results typed at the boundary.

```ts
// frontend/src/features/reports/reportStatus.ts
export type ReportStatus = 'free' | 'full';

export type ReportErrorCode =
  | 'not_authenticated'
  | 'too_far'
  | 'rate_limited_spot'
  | 'rate_limited_hourly'
  | 'location_unavailable'
  | 'unknown';

const REPORT_TTL_MS = 30 * 60 * 1000;

export function isActive(reportAt: string | null, now: number = Date.now()): boolean {
  return reportAt !== null && now - Date.parse(reportAt) < REPORT_TTL_MS;
}

export function errorCode(message: string | undefined): ReportErrorCode {
  switch (message) {
    case 'not_authenticated':
    case 'too_far':
    case 'rate_limited_spot':
    case 'rate_limited_hourly':
      return message;
    default:
      return 'unknown';
  }
}
```

Analytics events (PostHog, existing `posthog?.capture` pattern):
`spot_report_submitted { report_status, parking_spot_type, parking_access }`,
`spot_report_failed { reason: ReportErrorCode }`. **Never** coordinates,
`distance_m`, or user ids.

---

## Testing Strategy

### Database — `backend/tests/test_spot_reports.py` (pytest + psycopg2)

**Safety rule:** `backend/tests/conftest.py` connects to whatever
`DATABASE_URL` is set, and the local `backend/.env` has pointed at
**production** since the 2026-09-27 cutover. These tests write rows, so:

1. Run them against the local self-hosted stack via an explicit
   `DATABASE_URL=…localhost…` override (as SS3 did).
2. Every test runs inside a transaction that is **rolled back** (fixture),
   so even a mis-pointed run leaves no data behind.
3. A guard fixture skips the module if `DATABASE_URL` contains
   `supabase.freipark.com` or the OVH host, unless `ALLOW_PROD_DB_TESTS=1`.

Authenticated calls are simulated the way PostgREST does it:
`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',
'{"sub":"<test-user-uuid>","role":"authenticated"}', true);` with a test
user inserted into `auth.users` inside the same rolled-back transaction.

Cases:
- anon: `SELECT` on `spot_reports` returns no rows/denied; direct `INSERT` denied; `EXECUTE report_spot` denied
- authenticated: direct `INSERT`/`SELECT` on the table denied
- `report_spot` happy path at 10 m → row inserted, `expires_at = reported_at + 30 min`
- radius by type: `street` at 200 m → `too_far`; `lot` at 200 m → accepted; `lot` at 350 m → `too_far`
- each error: `invalid_status`, `spot_not_found`, `rate_limited_spot` (2nd report < 5 min), `rate_limited_hourly` (21st report)
- `spots_in_bbox`: returns `report_status`/`report_at` for an active report; `NULL` after `reported_at` is backdated 31 min; latest of two reports wins; never exposes a `user_id` column
- `spots_in_bbox` still callable by `anon`; existing columns unchanged
- deleting the test `auth.users` row cascades its reports
- `EXPLAIN ANALYZE` of `spots_in_bbox` on the Berlin bbox uses `idx_spot_reports_spot_latest` for the lateral join

### Frontend — Jest (`npx jest`)

- `reportStatus.test.ts`: `isActive` boundaries (29:59 vs 30:00), `errorCode` mapping
- `useReportSpot.test.ts` (mocked `supabase.rpc` + `expo-location`): sends fresh coords; maps each RPC error; location timeout → `location_unavailable`; no RPC call when signed out
- `ReportButtons.test.tsx`: signed-out tap opens auth; permission denied → disabled + hint; loading state; error text rendered
- `SpotDetailSheet.test.tsx`: status line shown for active report, hidden for expired/none
- `geo.test.ts`: `report_status`/`report_at` carried into feature properties
- Coverage: `features/reports/` ≥ 80% lines

### Manual (device / simulator)

- Report a street spot from within 150 m (simulator custom location) → ring appears after refetch; another account sees it
- Report a street spot from > 150 m → "You need to be at the spot" message
- Signed out → buttons open sign-in

---

## Privacy

`spot_reports` links an account to a place and time — PII-adjacent.

- Stored: `user_id`, `spot_id`, `status`, timestamps, `distance_m`. **Not** stored: reporter coordinates.
- Never exposed to other users: no API returns `user_id` for a report.
- Deleted with the account (cascade).
- `PRIVACY_POLICY.md` gains a "Spot reports" section (what's stored, why, retention, deletion) **in the same change** that ships the feature.
- Retention: see § Open Questions (proposed 30 days).

---

## Boundaries

- **Always:** apply `007` to the local stack and run `test_spot_reports.py` there before touching prod; keep `spots_in_bbox`'s existing columns/args stable; add all three locales together; keep reads aggregate-only (no `user_id` out).
- **Ask first:** applying `007` to production; any FastAPI route for reports; adding Realtime; changing the 150 m / 300 m / 5 min / 20 per hour / 30 min constants; new dependencies.
- **Never:** run write tests against prod without the rollback fixture; store reporter coordinates; expose `user_id`; gate browsing or existing features behind sign-in.

---

## Success Criteria

1. `007_spot_reports.sql` applies cleanly to a fresh local stack after `001`–`006`
2. `pytest tests/test_spot_reports.py -v` passes against the local stack, all cases in § Testing Strategy
3. `npx jest` passes; `npx tsc --noEmit` clean; `features/reports/` ≥ 80% line coverage
4. A signed-in user within range (150 m street / 300 m lot, garage, zone) can report a spot free/full in ≤ 2 taps after opening the sheet; the marker ring and sheet status line reflect it without restarting the app
5. A second device (signed out) sees the same report after panning
6. Report out of range, a repeat within 5 min, and the 21st in an hour are each rejected with the specific message — verified live once, not only in unit tests
7. Reports disappear from markers and the sheet 30 min after `reported_at`
8. `spots_in_bbox` p95 latency on the Berlin bbox is within +20% of today's (measure before/after with `EXPLAIN ANALYZE`, 10 runs)
9. No regression: all existing `SPEC-map.md` / `SPEC-auth.md` criteria still pass signed-out; existing frontend tests still pass
10. `PRIVACY_POLICY.md`, `CLAUDE.md` (MVP scope line), and `SPEC-infra.md` § Phase 2 (pointer to this spec) updated in the shipping change

---

## Open Questions

| Question | Status |
|---|---|
| Is the "small active user base" precondition met, and is updating `CLAUDE.md`'s "no real-time availability" MVP rule approved? | **Resolved 2026-10-07: approved** — see the scope note at the top. |
| Retention of expired reports | **Accepted 2026-10-07 (default approved with the spec):** delete rows older than 30 days via a daily job on the OVH box, next to the existing `backup_db.sh` cron (`pg_cron` isn't confirmed enabled in the self-hosted image). Expired-but-retained rows are useful for tuning the 30-min TTL later. **As built (R8):** the DELETE lives in a `purge_spot_reports(retention_days int)` function in migration `007` (no client role may execute it; rejects values < 1; returns the row count), called by `supabase/self-host/purge_spot_reports.sh` — so the SQL is covered by the DB tests rather than living only in a shell script. **Backups (decided 2026-10-07):** `spot_reports` is included in `backup_db.sh` (14-day backup retention). |
| Large lots/zones: centroid can be > 150 m from where the reporter stands | **Resolved 2026-10-07:** 150 m for `street`, 300 m for `lot`/`garage`/`zone`. Watch `too_far` failures in PostHog to tune. |
| Conflicting reports (free at 10:00, full at 10:02) | Latest wins (decided). Revisit with "2 of 3 say free" only if users complain. |
| Ring colours (teal / near-black) | **Decided 2026-10-07: keep teal.** Checked on the simulator in C1: on a green (free-access) fill the teal ring is low-contrast and reads as a slightly larger dot at normal zoom; clear on the other fills. Accepted as is; the sheet's status line is the primary signal. |
| Should reporters see their own report count / any thanks? | No for v1 (no profiles table yet — `SPEC-auth.md` deferred it). |
