# Spec: spot-address — Street address and coordinates for each spot

**Module:** `spot-address`
**Capability map:** [CLAUDE.md](CLAUDE.md) → after `spot-reports`. Depends on `infra` (import pipeline, `parking_spots`) and `map` (`SpotDetailSheet`, share message). Independent of auth.
**Status:** Implemented and live on production 2026-10-08 (SA1–SA7, `tasks/plan.md` § Implementation Plan: spot-address). Success criteria 1–6 met: Berlin 97.9% addressed, Germany 91.3%; full Berlin import 41 s; production per-source counts identical to local. Not yet in a released app build.

---

## Objective

When a driver taps a spot, show **where it is in words** — a street
address — and its **coordinates**, and include both in the shared
message. Today the sheet only says "Parking lot · Free parking".

**Hard constraint (CLAUDE.md):** no per-call costs that grow with users.
So no geocoding API at tap time. Addresses are worked out **once, at
import**, from OpenStreetMap data we already download, and stored with
the spot.

**Decided (2026-10-07):** address worked out at import (not self-hosted
Nominatim, not coordinates-only).

### What the data supports (measured 2026-10-07, Berlin, 63,751 spots)

| Source | Coverage |
|---|---|
| Spot's own `addr:street` + `addr:housenumber` tags | ~0.3% of all spots (598 lots, 1,141 garages Germany-wide) |
| Street-parking ways' own `name` (the street itself) | 92.5% of `street` spots |
| Nearest OSM address point ≤ 60 m | 92.3% (72.3% ≤ 30 m) |
| Nearest named street ≤ 60 m | 93.6% |
| **Address point or street ≤ 60 m** | **97.9%** |

Computing nearest address + street for all of Berlin took **5.9 s**
(GiST KNN), so it fits inside each city's import.

**Not this module's job:** reverse geocoding on demand, address search
(search already uses Nominatim and is unchanged), house-number accuracy
guarantees, copy-to-clipboard (needs a new dependency — later, ask first).

---

## Address rule

For each spot, first match wins:

| # | Source | Example display | `address_source` |
|---|---|---|---|
| 1 | Spot's own `addr:street` (+ `addr:housenumber`, `addr:postcode`) | Oranienstraße 12, 10997 Berlin | `own_tags` |
| 2 | `street` spot: the way's own `name` | Oranienstraße | `street_name` |
| 3 | Nearest OSM address point ≤ **60 m** | near Oranienstraße 12, 10997 Berlin | `nearest_address` |
| 4 | Nearest **named** street ≤ **60 m** (cars can use it: not footway, path, cycleway, steps, track…) | near Oranienstraße | `nearest_street` |
| — | nothing within 60 m | *(no address line; coordinates still shown)* | `NULL` |

- "near" is shown for rules 3–4 because the address belongs to a
  neighbouring building or the street beside the spot, not to the spot.
- The city in the display is the spot's city (`cities.name`).
- 60 m keeps the result honest: further away, "near X" stops being useful.

---

## Data model — migration `010_spot_address.sql`

```sql
ALTER TABLE parking_spots
  ADD COLUMN address_street      text,
  ADD COLUMN address_housenumber text,
  ADD COLUMN address_postcode    text,
  ADD COLUMN address_source      text
    CHECK (address_source IN ('own_tags', 'street_name', 'nearest_address', 'nearest_street')),
  ADD COLUMN address_distance_m  real;   -- 0 for own_tags / street_name
```

Nullable, additive, no default — existing rows stay valid until
backfilled.

**Read path — new RPC, not `spots_in_bbox`:**

```sql
spot_details(p_spot_id uuid)
  RETURNS TABLE (address_street text, address_housenumber text,
                 address_postcode text, address_source text, city_name text)
  -- STABLE, SECURITY DEFINER, pinned search_path; GRANT to anon, authenticated
```

Fetched when the sheet opens. Keeps the map query lean: adding address
text to all 2,000 rows of every `spots_in_bbox` call would grow every pan
for data only needed on tap. Coordinates are already on the client.

---

## Import

`import_osm.py` gains an address step that runs **after** the upsert,
for the city just imported, from the same (bbox-clipped) PBF:

1. `osmium tags-filter nwr/addr:housenumber` → address points;
   `osmium tags-filter w/highway` → named, car-usable streets.
2. Load both into **temporary** tables (dropped at the end — no permanent
   table of every address in Germany), with GiST indexes.
3. One `UPDATE parking_spots … FROM LATERAL (… ORDER BY geom <-> location
   LIMIT 1)` applying the rule above to this city's spots.
4. Log counts per `address_source`.

Rules 1–2 also apply at row level in `_feature_to_row` (own tags / way
name), so they need no spatial lookup.

**Backfill:** re-run `import_all.py` locally (all 80 cities), then copy
the five address columns to production keyed by `(osm_id, osm_type)` —
staged and applied in one transaction, as with the city expansion (`008`).

---

## UI

Spot sheet, under the type/access lines:

```
Parking lot
Free parking
📍 near Oranienstraße 12, 10997 Berlin       ← when an address exists
52.50562, 13.39693                           ← always
```

- Coordinates show immediately (already in the spot row), `lat, lon`, 5
  decimals; address appears when `spot_details` returns. Failed or
  missing address → no address line, no error message.
- "near" localised: DE "bei …", TR "… yakınında".
- **Share message** gains the address line above the coordinates.

---

## Tests

- **Importer unit tests:** rule 1 (own tags, incl. partial — street
  without number), rule 2 (street way `name`), nothing for others.
- **DB tests** (local, rolled back): the address `UPDATE` on fixture
  spots/points/streets — nearest wins, 60 m cut-off, footways ignored,
  own tags not overwritten; `spot_details` returns fields + city for
  `anon`; unknown id → no row.
- **Frontend:** sheet shows coordinates immediately and the address once
  loaded; "near" only for rules 3–4; no line when there's no address;
  share message includes it; all three languages.
- **Import run:** Berlin locally — per-source counts should match the
  measurement above (≈98% with an address).

---

## Boundaries

- **Always:** compute at import; keep `spots_in_bbox` unchanged; drop the
  temporary address/street tables in the same run.
- **Ask first:** applying `010` and the backfill to production; any new
  dependency (e.g. clipboard); changing the 60 m limit.
- **Never:** call a geocoding API per tap or per spot from the app or
  server; store a permanent copy of all OSM addresses.

---

## Success Criteria

1. `010` applies cleanly after `009`; re-running is safe.
2. After a local backfill, ≥ 95% of spots in Berlin have an address
   (measured: 97.9%); every row's `address_source` matches the rule.
3. Import time per city grows by ≤ 30 s for Berlin-sized cities.
4. Tapping a spot shows coordinates instantly and the address within one
   request; the share message contains both.
5. Backend and frontend suites pass; `tsc` clean; no `any`.
6. Production: same per-source counts as local after the copy.

---

## Open Questions

| Question | Decided 2026-10-07 (defaults accepted) |
|---|---|
| Show coordinates for everyone, or only on a "details" tap? | Always — one small line; useful for sharing and for drivers. |
| Postcode for rules 1/3 only (OSM streets don't carry one)? | Yes — rule 4 shows street + city without postcode. |
| Tap-to-copy coordinates/address | Later; needs `expo-clipboard` (new dependency → ask first). Share covers it for now. |
