# Spec: road-closures — Roadworks and closures on the map

**Module:** `road-closures`
**Capability map:** [CLAUDE.md](CLAUDE.md) → after `settings`. Depends on `infra` (database, OVH box, cron, OSM extracts) and `map` (map layers, sheets). Independent of auth.
**Status:** Approved 2026-10-08 (open-question defaults accepted; Autobahn licence still to be confirmed before release) — tasks in `tasks/plan.md` § Implementation Plan: road-closures.

---

## Objective

Show drivers **where roads are closed or under works**, Germany-wide,
as a map layer they can tap for details.

**Decided (2026-10-07):** v1 = **Autobahn API + OpenStreetMap, map only**.
Directions do **not** avoid closures (that would mean re-processing OSRM's
Germany graph whenever closures change). City feeds (e.g. Berlin VIZ) and
Mobilithek are later add-ons.

**Hard constraint (CLAUDE.md):** no per-call costs that scale with users.
Both sources are free; the server fetches them on a schedule and the app
reads only our own database.

### What the sources actually contain (measured 2026-10-08)

**Autobahn API** (`verkehr.autobahn.de/o/autobahn`, no key) — one full
sweep of all 112 motorways × {roadworks, closure} = 224 requests, 123 s,
9.2 MB, 1 failed request:

| Type (`display_type`) | Count |
|---|---|
| `ROADWORKS` (long-term) | 1,840 |
| `SHORT_TERM_ROADWORKS` | 1,610 |
| `CLOSURE_ENTRY_EXIT` (junction ramp closed) | 585 |
| `CLOSURE` (carriageway closed) | 88 |

Every item has a `LineString` geometry, a title ("A100 | Beusselstraße -
Spandauer Damm"), a subtitle (direction), a start timestamp and a German
free-text description (phase start/end dates). **`isBlocked` is `false`
on every item, closures included** — so the type drives the display,
never that flag. The road list contains a duplicate with a trailing
space (`"A60 "`); names are trimmed and items deduplicated by
`identifier`.

**OpenStreetMap** `highway=construction` (Berlin extract): 544 ways, but
~210 are footways/paths/cycleways and the rest mostly mark roads being
**built or rebuilt** (e.g. 21 segments of the A100 extension), two thirds
with an `opening_date`. OSM is good for "this road isn't open yet"; it
is **not** a source of short repair closures on city streets. Shown, but
styled as its own, quieter category.

**Honest coverage statement for v1:** all motorway roadworks/closures,
plus OSM roads under construction everywhere. Short-term closures on
ordinary city streets are **not** covered — no free nationwide source
exists (city feeds come later).

---

## Data model — migration `011_road_events.sql`

```sql
CREATE TABLE road_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text        NOT NULL CHECK (source IN ('autobahn', 'osm')),
  source_id   text        NOT NULL,          -- Autobahn identifier / OSM "way/123"
  kind        text        NOT NULL CHECK (kind IN
                ('closure', 'entry_exit_closure', 'roadworks', 'short_term_roadworks', 'construction')),
  road        text,                          -- "A100", or the OSM street name
  title       text        NOT NULL,
  subtitle    text,                          -- direction, for Autobahn
  description text[]      NOT NULL DEFAULT '{}',
  starts_at   timestamptz,
  ends_at     timestamptz,                   -- parsed when the source gives one
  geom        geometry(Geometry, 4326) NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX ON road_events USING gist (geom);
-- RLS on, no client grants; read via the RPC below.
```

**Read path:** `road_events_in_bbox(min_lon, min_lat, max_lon, max_lat, lim)`
→ `id, kind, road, title, subtitle, description, starts_at, ends_at,
geometry (GeoJSON)`; `SECURITY DEFINER`, pinned `search_path`, EXECUTE to
`anon`, `authenticated`. Same pattern as `spots_in_bbox`.

---

## Ingestion

### Autobahn — every 30 minutes, on the OVH box

`backend/scripts/fetch_autobahn.py`, run by cron (`*/30 * * * *`) in the
existing `api` container (Python 3.12 + httpx already there; the image
copies all of `backend/`, so the script ships with it — the `api`
container needs one rebuild, `docker compose up -d --build api`, to pick
it up):

1. Fetch the road list; trim and de-duplicate names.
2. For each road: `services/roadworks` and `services/closure`, ~0.2 s
   apart, honest `User-Agent`, per-request timeout, failures counted not
   fatal.
3. Map `display_type` → `kind`; parse an end date from the description
   when present ("Ende: 21.10.26 um 16:00 Uhr", time windows such as
   "12.10.26 von 10:00 bis 16:00 Uhr" or "08.10.26 21:00 bis zum
   09.10.26 05:00 Uhr", else the whole project's end date), else NULL.
4. Upsert by `(source, source_id)` in one transaction.
5. **Delete Autobahn rows not seen in this sweep — only if ≥ 95% of
   requests succeeded.** An API outage must not wipe the map.
6. Log counts per kind and the failure count.

### OSM — with the existing OSM import

`highway=construction` ways whose `construction=*` is a car road type
(motorway … residential, service, living_street; **not** footway, path,
cycleway, steps, track, bridleway, pedestrian), from the 16 state
extracts already cached for the parking import. Ways whose `opening_date` is more than 30 days past are skipped (most likely open already; OSM not yet updated — 2% of ways on 2026-10-08). Run alongside
`import_all.py` (same cadence, same Mac → production transfer pattern as
the parking data). `ends_at` from `opening_date` when present.

---

## Map and UI

- **`RoadEventsLayer`** (MapLibre line layer, below the parking markers):

  | Kind | Style |
  |---|---|
  | `closure` | red `#dc2626`, 5 px |
  | `entry_exit_closure` | red `#dc2626`, 4 px, dashed |
  | `roadworks` | orange `#f97316`, 4 px |
  | `short_term_roadworks` | amber `#f59e0b`, 3 px, dashed |
  | `construction` (OSM) | grey `#64748b`, 3 px, dotted |

  Fetched with the spots on each (debounced) region change; hidden below
  zoom 9 to keep country-wide views clean.
- **Tap a line → `RoadEventSheet`:** type label ("Closure", "Roadworks",
  "Under construction" — de/en/tr), title, direction, period ("until
  21 Oct, 16:00" when known), the description lines (German, as provided
  by the source; not translated), and the source ("Autobahn GmbH" /
  "OpenStreetMap").
- No settings toggle in v1 (see Open Questions).

---

## Tests

- **Parser unit tests** (`fetch_autobahn.py`): `display_type` → `kind`
  for all four types, unknown type skipped; end-date parsing from real
  description lines; names trimmed / deduplicated; malformed items skipped.
- **Ingestion DB tests** (local, rolled back): upsert; second sweep
  updates in place; rows missing from a successful sweep deleted; **not
  deleted when < 95% of requests succeeded**.
- **OSM filter unit tests:** car-road `construction=*` kept, footway etc.
  dropped.
- **RPC DB tests:** bbox filter, anon access, no client access to the table.
- **Frontend:** layer paint per kind; sheet content per kind, with and
  without end date; zoom threshold.
- **Live check:** one real sweep locally; counts per kind logged; the A100
  roadworks visible in Berlin on the simulator.

---

## Boundaries

- **Always:** fetch on the server only; never call the Autobahn API from
  the app; keep the ≥ 95 % guard on deletions; credit the source in the
  sheet.
- **Ask first:** installing the cron on the OVH box; any city feed or
  Mobilithek; making directions avoid closures; changing refresh interval.
- **Never:** per-user calls to a third-party traffic API; paid traffic
  data (TomTom, HERE…).

---

## Success Criteria

1. A real local sweep stores ≈ all items (counts per kind match the live
   API within the failure count).
2. A simulated failed sweep (< 95 %) deletes nothing.
3. Berlin on the simulator shows the A100 roadworks and a tappable sheet.
4. OSM construction ways appear, styled distinctly; no footways/cycleways.
5. Backend + frontend suites pass; `tsc` clean; no `any`.
6. Production: cron running every 30 min, logged; layer visible in the
   app against production.

---

## Open Questions

| Question | Decided 2026-10-08 (defaults accepted) |
|---|---|
| **Licence/terms of the Autobahn API data** | **Must confirm before release.** The API is public and documented on bund.dev, but I haven't found explicit reuse terms; credit "Autobahn GmbH des Bundes" in the sheet and check the terms (or ask them) before shipping to users. |
| Keep OSM "under construction" in v1, given it's mostly new roads, not repairs? | Yes, styled quietly as "Under construction". Easy to drop. |
| A Settings toggle to hide the layer? | Not in v1. Add if users find it noisy. |
| Translate the German descriptions? | No — shown as provided (dates and places are readable); titles and types are localised. |
| Refresh interval | 30 min (one sweep ≈ 2 min, 9 MB). |
