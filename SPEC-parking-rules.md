# Spec: parking-rules — "Can I park here now, and until when?"

**Module:** `parking-rules`
**Capability map:** [CLAUDE.md](CLAUDE.md) → after `analytics-consent`. Depends on `map` (spot sheet, `spot_details`) and the OSM import (raw tags already stored in `parking_spots.tags`). No new external service.
**Status:** Approved 2026-10-08 (open-question defaults accepted) — tasks in `tasks/plan.md` § Implementation Plan: parking-rules.

---

## Objective

Drivers get tickets because German parking rules change by the hour and
the sign is hard to read ("Mo–Fr 9–20 h gebührenpflichtig, Anwohner
Zone 23 frei"). For a tapped spot, FreiPark should say **in one line what
applies right now and until when**:

- "Free now · paid from 09:00"
- "Paid now until 20:00 · then free"
- "Residents only (zone 23)"
- "No parking until 17:00"
- "Max. 3 h until 20:00"

From data that's already free (OpenStreetMap), evaluated on the phone —
**no per-call cost, no AI, no cameras**. It's the low-risk core of the
"fine prevention" idea; a sign-photo reader can come later as a way to
*verify* these rules.

---

## What the data actually contains (measured 2026-10-08)

Berlin extract of 2026-08-21; the other cities from the cached city-area
extracts. "Curb-km" counts each side of a public car road separately.

### Berlin is exceptionally well mapped

| | Berlin | Inside S-Bahn Ring | Outside |
|---|---|---|---|
| Curb with any parking tag | **92 %** of 12,836 km | **99 %** | 90 % |
| …of parkable curb, with a rule (paid/free/zone/limit) | **86 %** | 94 % | 84 % |
| …of parkable curb, with a time-dependent rule | 19 % | **58 %** | 10 % |

- **Tagging scheme:** 99.9 % uses the current `parking:left/right/both`
  scheme; the old `parking:lane:*` scheme is practically gone.
- **The rules sit on the spots we already import.** Berlin also maps
  street parking as 84,428 separate `amenity=parking` areas
  (`parking=street_side|lane|on_kerb|half_on_kerb|shoulder`). Those carry:

  | Tag | Share of areas |
  |---|---|
  | `fee` | 83 % |
  | `fee:conditional` (paid hours) | 16 % |
  | `zone` (residents' zone) | 16 % |
  | `restriction*` | 7 % |
  | `maxstay*` | 2 % |

  The raw tags are already in `parking_spots.tags`, so v1 needs **no
  curb matching and no re-import**.
- **Syntax:** 96 % of the 17,136 time-dependent values are in the
  standard `value @ (opening hours)` form, dominated by a handful of
  patterns, e.g. `no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)`
  (5,036 ×), `3 hours @ (Mo-Fr 08:00-20:00; Sa 08:00-14:00)`.

### Everywhere else it's thin

Across the other 78 cities, the median coverage is **8 %** of curb-km.
None reaches 50 %; 16 reach 20 % (best: Chemnitz 41 %, Freiburg 35 %,
Munich 33 %, Karlsruhe 29 %, Leipzig 28 %, Potsdam 25 %, Frankfurt
25 %). Hamburg 23 %, Cologne 7 %. (City-area extracts include some
surroundings, which lowers these figures a little.)

**Consequence:** v1 is a Berlin feature that works elsewhere *where the
tags exist* and says "rules unknown — check the signs" otherwise. Filling
the gaps (crowd verification, contributing back to OSM) is a later
module.

### Bug found while measuring

`import_osm._spot_type()` only recognises the old `parking:lane` tags,
so all 84k Berlin street-parking areas are stored as **`lot`**. Effects:
the sheet says "Parking lot" for kerbside parking, and spot reports get
the 300 m radius instead of 150 m. Fixed as part of this module (PR1).

---

## Design

### Data path (no new endpoint)

- **`spot_details` v2** (migration `012_spot_rules.sql`) also returns
  `rule_tags jsonb`: the subset of `parking_spots.tags` that carries
  rules — `fee`, `fee:conditional`, `maxstay`, `maxstay:conditional`,
  `restriction`, `restriction:conditional`, `zone`, `access`,
  `access:conditional`, `authentication:disc`, `parking:disc`. Fetched
  only when a spot is tapped (as the address is today), so
  `spots_in_bbox` — every map pan — stays unchanged.
- **Same migration:** `UPDATE parking_spots SET spot_type = 'street'`
  where `tags->>'parking'` is one of the street kinds (one-off fix for
  existing rows), and the import's `_spot_type` learns the same rule.

### Rules engine (client, `src/features/rules/`)

- **`parseRules(tags) → SpotRules`** — strict types, no `any`:

  ```ts
  type Window = { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; from: number; to: number }; // minutes, 0–1440
  interface SpotRules {
    fee: 'yes' | 'no' | null;          // base value
    feeWindows: { value: 'yes' | 'no'; when: Window[] }[];
    maxstayMin: number | null;
    maxstayWhen: Window[] | null;      // null = always
    disc: boolean;
    zone: string | null;               // residents' zone, e.g. "23"
    restriction: 'no_parking' | 'no_stopping' | 'loading_only' | 'charging_only' | null;
    restrictionWhen: Window[] | null;
    unknown: string[];                 // raw values we couldn't read
  }
  ```

  Parses the opening-hours **subset** that covers the measured data:
  weekday ranges and lists (`Mo-Fr`, `Sa,Su`), time ranges incl. `24:00`
  and several per day, `;` rules, bare weekdays (`Su` = all day),
  `off`. Anything else (`PH`, months, sunrise…) goes to `unknown` — never
  guessed. Written in-house (~150 lines): the standard `opening_hours`
  JS library is LGPL-3.0, awkward inside an app bundle, and much larger
  than this needs.
- **`ruleNow(rules, now) → { headline, until, details[] }`** evaluated
  in `Europe/Berlin` time (DST-safe), looking ahead up to 7 days for the
  next change ("until", "from").
- Precedence: restriction now → residents-only → paid now → free now →
  unknown. `maxstay` and disc are added as details.

### UI

- **Spot sheet:** one coloured headline line under the type
  (green "Free now…", amber "Paid now…", purple "Residents only…", red
  "No parking…", grey "Rules unknown — check the signs"), details below
  (max stay, disc, zone).
- **Always shown with:** "From OpenStreetMap — signs on site take
  precedence." (liability; de/en/tr).
- `access=no|private` street areas show "Not public".

### Out of scope (v1)

Map markers coloured by the current rule (needs rules in
`spots_in_bbox`; see Open Questions), road-side `parking:left/right`
tags for cities without separate areas, public holidays, crowd
verification, sign photos, contributing to OSM.

---

## Tests

- **Parser (jest, table-driven):** the 12 most frequent real Berlin
  values verbatim; `24:00`; several ranges per day; bare `Su`; `off`;
  `Sa-Su`; spacing variants (`;Sa`); unknown syntax → `unknown`, never a
  wrong window.
- **Evaluator:** free→paid boundary at 09:00 and 20:00; Saturday
  18:00 cut-off; Sunday all day; midnight wrap; **DST** weekends (last
  Sunday of March and October); restriction beats fee; residents beats
  fee; no rule tags → "unknown".
- **Migration (DB, rolled back):** `spot_details` returns `rule_tags`
  with only the allowed keys; street-kind spots become `street`; RPC
  grants unchanged.
- **Import:** `_spot_type` for each street kind; existing lot/garage
  cases unchanged.
- **Sheet:** headline per state; disclaimer always present; unknown state.
- **Simulator (Berlin):** a paid street in Mitte before/after 09:00
  (by changing the simulator clock), a residents' zone, an outer-district
  free street.

---

## Boundaries

- **Always:** say "unknown" rather than guess; show the disclaimer;
  evaluate in German local time.
- **Ask first:** colouring markers by rule (bigger payload on every pan);
  adding public-holiday data; any OCR/photo feature.
- **Never:** a paid rules/OCR API; claim a spot is legal when a tag is
  unreadable.

---

## Success Criteria

1. Tapping a Berlin street spot shows the correct current rule and the
   next change for ≥ 95 % of spots that carry rule tags (measured over a
   sample of 200 spots against their tags).
2. Unreadable values never produce a "free"/"paid" headline.
3. Street parking shows as street (not lot) and uses the 150 m report
   radius.
4. Backend + frontend suites pass; `tsc` clean; no `any`.
5. Checked on the simulator at three times of day.

---

## Open Questions

| Question | Decided 2026-10-08 (defaults accepted) |
|---|---|
| Colour map markers by the current rule (green/amber/purple/red)? | **Later (v2).** Needs `rule_tags` in `spots_in_bbox`, i.e. a bigger payload on every pan. Sheet first; measure use. |
| Public holidays (`PH`)? | **Unknown in v1.** 225 of 19,755 conditional tags on Berlin parking features (1.1 %) mention `PH`; a holiday table per state later. |
| Cities with thin tagging | Show "Rules unknown — check the signs". A later `rule-verification` module (crowd "Is this right?" + contributing to OSM) fills gaps. |
| Use road-side `parking:left/right` tags where no separate areas exist? | **v2.** Needs matching spots to curb sides; worth it once a second city is targeted. |
| Refresh the OSM extracts? | Berlin's cached extract is from 2026-08-21; re-run the import monthly (separate infra task). |
