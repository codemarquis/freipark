# Spec: Map Module

## Objective

Render a live, interactive map of parking spots using the tile data
already served from Cloudflare R2 (`berlin.pmtiles`) and the spot
records already in Supabase.

> **Status update (2026-08-23):** what shipped goes beyond this spec's
> original Berlin-only scope. `parking_spots` now covers 30+ major German
> cities (see `SPEC-infra.md` § Seeded Cities), and two features not in the
> original spec were added: a location search bar (§ Search & Geocoding)
> and in-app turn-by-turn routing to a selected spot (§ Routing). Sections
> below are updated to describe the app as it actually exists; original
> MVP language ("Berlin", no routing) has been superseded.

**User story:** A driver opens FreiPark, sees a map centred on their
location (or Berlin, as a fallback) with colour-coded parking markers,
searches for an address or scrolls/zooms freely, taps a spot to read its
type and access rules and get walking/driving directions, and — for paid
spots — gets a button that opens the EasyPark or ParkNow App Store listing
so they can download the payment app.

**Success looks like:** A real device (or simulator) showing clustered
parking spots anywhere in Germany, rendered from live DB data, with
directions to a tapped spot, and zero per-tile or per-request API costs
for anything FreiPark itself operates (see § Routing for the one caveat:
search uses a free third-party API, not a cost we control).

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Expo SDK 57, managed workflow | No bare eject; OTA updates. Single `App.tsx` root component — **not** Expo Router; no `app/` directory exists |
| Map renderer | `@maplibre/maplibre-react-native` ^11 | OSS, zero tile-API cost |
| Tile source | Protomaps PMTiles on Cloudflare R2 | HTTP range requests, zero egress |
| Spot data | `@supabase/supabase-js` v2, anon key | RLS already set to public read |
| Spot query | PostgREST RPC `spots_in_bbox` | Migration 002; returns ≤ 2000 pts |
| Bottom sheet | `@gorhom/bottom-sheet` v5 | Industry-standard RN bottom sheet |
| Linking | `expo-linking` | App Store / Play Store URLs only |
| Location | `expo-location` | Foreground permission; centers camera on launch |
| Search / geocoding | Nominatim (OpenStreetMap) public API, called directly from the client | Free, no API key — but third-party, rate-limited, and outside our uptime control. See § Search & Geocoding |
| Routing | FastAPI `/route` endpoint → self-hosted OSRM (Docker) | Zero per-call cost since OSRM runs on our own infra. See § Routing and `SPEC-infra.md` § Routing infra |

**Hard constraints (inherited from project):**
- No per-call API costs that scale with users
- No in-app payments — payment app handoff only
- No undocumented deep-link URI schemes (EasyPark/ParkNow have no public scheme)

---

## Commands

```bash
# Bootstrap (one-time)
cd frontend && npx create-expo-app@latest . --template blank-typescript

# Dev
cd frontend && npx expo start              # Metro + Expo Go QR
cd frontend && npx expo run:ios            # iOS simulator (needs Xcode)
cd frontend && npx expo run:android        # Android emulator (needs Android Studio)

# Tests
cd frontend && npx jest                    # Unit + hook tests
cd frontend && npx jest --coverage         # With coverage report

# DB migration (spots_in_bbox RPC)
supabase db push                           # Applies 002_spots_in_bbox.sql
```

---

## Project Structure

```
frontend/
  App.tsx                  → Root component — renders <MapScreen /> directly (no router)
  index.ts                 → Expo entry point (registerRootComponent)
  src/
    features/
      map/
        MapScreen.tsx      → Full-screen MapLibre map, wires layers, search, routing, sheet
        SpotLayer.tsx      → GeoJSON source, cluster layers, circle layers
        SpotDetailSheet.tsx → Bottom sheet: spot info, route summary, payment CTA
        SearchBar.tsx      → Address search input + results dropdown
        useGeocoder.ts     → Debounced Nominatim geocoding hook
        RouteLayer.tsx     → Renders the route polyline returned by useRoute
        useRoute.ts        → Hook: fetches /route from the FastAPI backend
        useSpots.ts        → Hook: calls spots_in_bbox on viewport change
        PaymentLinks.tsx   → EasyPark / ParkNow App Store link buttons
    lib/
      supabase.ts          → Supabase JS singleton (anon key)
      geo.ts               → Bbox helpers (MapLibre bounds → lon/lat tuple)
      types.ts             → Shared types (SpotRow, etc.)
  __tests__/
    useSpots.test.ts
    geo.test.ts
    SpotDetailSheet.test.tsx
  assets/                  → App icon, splash
  app.json
  package.json
  tsconfig.json
  .env                     → GITIGNORED — real keys
  .env.example             → Already committed
```

> Note: `PaymentLinks.tsx` lives under `src/features/map/`, not a separate
> `src/features/payments/` folder as originally planned — it's small and
> only ever used from `SpotDetailSheet`, so it wasn't split out.

```
supabase/
  migrations/
    001_initial_schema.sql       → Applied — cities + parking_spots tables
    002_spots_in_bbox.sql        → Applied — RPC function for map queries
    003_grant_anon_select.sql    → Applied — anon SELECT grant fix
    004_add_german_cities.sql    → Applied — seeds 30+ German cities beyond Berlin
```

---

## Data Contract: `spots_in_bbox` RPC

Migration `002_spots_in_bbox.sql`:

```sql
CREATE OR REPLACE FUNCTION public.spots_in_bbox(
  min_lon  float8,
  min_lat  float8,
  max_lon  float8,
  max_lat  float8,
  lim      int DEFAULT 2000
)
RETURNS TABLE (
  id        uuid,
  spot_type text,
  access    text,
  operator  text,
  capacity  int,
  lon       float8,
  lat       float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    ps.id,
    ps.spot_type,
    ps.access,
    ps.operator,
    ps.capacity,
    ST_X(ps.location) AS lon,
    ST_Y(ps.location) AS lat
  FROM parking_spots ps
  WHERE ps.location && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.spots_in_bbox TO anon, authenticated;
```

Frontend call:

```ts
const { data } = await supabase.rpc('spots_in_bbox', {
  min_lon, min_lat, max_lon, max_lat, lim: 2000,
});
```

---

## Spot Visualisation

**GeoJSON source with MapLibre clustering.** All returned spots load into a
single `ShapeSource`; MapLibre handles cluster merging at the GL level (no
JS overhead per frame).

| Layer | Type | Condition |
|---|---|---|
| `clusters` | circle, radius scales with `point_count` | zoom < cluster threshold |
| `cluster-count` | symbol (number label) | zoom < cluster threshold |
| `spots` | circle, coloured by `access` | zoom ≥ cluster threshold |

**Colour map:**

| `access` value | Colour | Hex |
|---|---|---|
| `free` | Green | `#22c55e` |
| `paid` | Blue | `#3b82f6` |
| `permit` | Amber | `#f59e0b` |
| `private` | Red | `#ef4444` |
| `null` / unknown | Grey | `#94a3b8` |

**Bug fixed 2026-08-24: `<Layer>` needs an explicit `source` prop in this
library version.** `SpotLayer`/`RouteLayer` originally relied on JSX
nesting inside `<GeoJSONSource>` to associate each `<Layer>` with its
source — the pattern most `@rnmapbox/maps`-derived code assumes. In
`@maplibre/maplibre-react-native` v11.3.6 that assumption is wrong:
nesting alone renders nothing, no error, no warning — the data reaches
`SpotLayer` correctly (confirmed via a temporary diagnostic log: 1000
correctly-shaped features, valid coordinates, no fetch/transform issue)
but the native layer never gets attached to its source. Fix: pass
`source="spots"` (and `source="route"` in `RouteLayer`) explicitly,
matching the library's own "Basic Usage" doc example. Confirmed on-device:
clusters render with correct counts across Berlin, and update correctly
on pan. `spots-cluster-count`'s own hardcoded `text-font` (a layer defined
outside `protomapsLayers()`'s output, so untouched by the § Glyph Hosting
rename) was also switched to key off `EXPO_PUBLIC_GLYPHS_URL` the same
way, so it doesn't regress into the same corruption bug once the R2
mirror goes live.

---

## Interactions

**Tap cluster** → camera animates to cluster centroid, zoom +2.

**Tap single spot** → `SpotDetailSheet` slides up (half-screen snap point).

**SpotDetailSheet content:**

```
Spot type:   Street / Garage / Lot / Zone
Access:      Free / Paid / Permit / Private
Operator:    [operator name or —]
Capacity:    [N spaces or —]

[For access = "paid" only:]
┌─────────────────────────────────────┐
│  Pay via EasyPark                   │  → App Store / Play Store listing
│  Pay via ParkNow                    │  → App Store / Play Store listing
└─────────────────────────────────────┘
```

**Store URLs (constants in `PaymentLinks.tsx`):**

```ts
const EASYPARK_IOS     = 'https://apps.apple.com/app/easypark/id498679136';
const EASYPARK_ANDROID = 'https://play.google.com/store/apps/details?id=net.easypark.android';
const PARKNOW_IOS      = 'https://apps.apple.com/app/park-now/id535970435';
const PARKNOW_ANDROID  = 'https://play.google.com/store/apps/details?id=com.parknow.android';
```

No undocumented URI schemes. `Linking.openURL` opens the store natively on
device, or falls back to the web URL in Expo Go / browser.

### Share a spot (added 2026-10-07)

A **Share** button in `SpotDetailSheet` opens the phone's own share sheet
(React Native `Share.share` — no new dependency, no FreiPark server
involved), so a driver can send a spot to someone via WhatsApp, SMS, mail,
etc. The recipient doesn't need FreiPark.

Message (localised, built by a pure `buildShareMessage` helper):

```
Parking lot · Free parking
Reported free · 4 min ago            ← only while a report is active
52.50562, 13.39693
https://www.google.com/maps/search/?api=1&query=52.50562,13.39693
```

- **Link:** Google Maps' documented cross-platform URL — opens the Maps app
  on iOS and Android, or the browser. A link only: no API key, no call
  from FreiPark, so no per-use cost.
- **Coordinates:** 5 decimals (~1 m), `lat, lon` order as people paste
  them into map apps.
- **Address:** added to the message once spots carry one (address task).
- **Analytics:** `spot_shared` with `parking_spot_type`, `parking_access`
  and whether the share sheet completed — never coordinates.

---

## Search & Geocoding

*(Not in the original spec — added post-MVP.)*

`SearchBar.tsx` renders a floating text input over the map. `useGeocoder.ts`
debounces input (400 ms) and, once the query is ≥ 2 characters, calls the
public Nominatim (OpenStreetMap) search API directly from the client:

```
https://nominatim.openstreetmap.org/search?q=<query>&format=json&limit=6&countrycodes=de
```

Results are constrained to Germany (`countrycodes=de`) and capped at 6.
Selecting a result flies the camera to that location (zoom 14).

**Why this doesn't violate the "no per-call API cost" constraint:** Nominatim
is free and requires no API key or account. It is, however, a third-party
service outside our control, bound by
[Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/)
(max ~1 req/sec, requires a descriptive `User-Agent` — already set to
`FreiPark/1.0 (geraldezeani@pm.me)`). If search volume grows enough to risk
that limit, the fix is self-hosting Nominatim or switching to a paid
geocoder — not something FreiPark controls today. Treat this as a known
risk, not a solved problem.

---

## Routing

*(Not in the original spec — added post-MVP.)*

Tapping a spot with a known user location fetches driving directions from
the FastAPI backend, which proxies to a **self-hosted** OSRM instance
(zero per-call cost — see `SPEC-infra.md` § Routing infra for the Docker
Compose setup):

```
GET {EXPO_PUBLIC_API_URL}/route?from_lon=&from_lat=&to_lon=&to_lat=
→ { geometry: GeoJSON.LineString, distance_m, duration_s, region }
```

- `useRoute.ts` fires this request whenever the user's location or the
  selected spot changes; results (or errors) surface in `RouteState`.
- `RouteLayer.tsx` draws the returned line string on the map.
- `SpotDetailSheet` shows `"850 m · 3 min"` (formatted distance/duration),
  a "Getting directions…" hint while loading, or "Directions unavailable."
  on error — see `SpotDetailSheet.test.tsx` for the exact formatting rules.
- If location permission was denied, the sheet shows "Enable location to
  see directions." instead of attempting a route at all.
- Backend-side: `backend/routers/route.py` validates the destination falls
  inside a known `Region` (`backend/routers/regions.py` — currently just
  `germany`, dispatched by bounding box) before calling OSRM, and rate-limits
  to 30 requests/minute per IP via `slowapi`.

This is a driving-route summary shown inline in the sheet, not full
turn-by-turn navigation — there's no in-app maps-style step list. For
actual navigation, `SpotDetailSheet` still offers "Open in Apple/Google
Maps" buttons that hand off to the device's native maps app.

---

## Location & Camera Behaviour

*(Expanded from the original "Initial Camera" section — actual behavior is
more involved than a static center point.)*

**Fallback centre:** `{ lon: 13.4050, lat: 52.5200 }` (Berlin Mitte), zoom 12.

**On launch**, `MapScreen` requests foreground location permission
(`expo-location`) and:

- **Granted + fix available:** once the fix resolves, the camera flies
  (`flyTo`, zoom 15, 1.2 s) to the user's location — but only if that
  location falls inside Germany's bounding box
  (`{ west: 4.5, south: 46.5, east: 15.1, north: 55.1 }`, matching the
  `maxBounds` the `Camera` component is constrained to). This guards
  against the iOS Simulator's default location (Cupertino, CA), which is
  outside tile coverage — in that case the map stays on the Berlin
  fallback instead of flying to a location with no rendered tiles.
- **Granted, fix still resolving:** a small "Locating…" chip shows near the
  top of the screen; spot loading is not blocked on this.
- **Denied/restricted:** a dismissible banner reads "Enable location to
  find spots near you" with a button that opens the device's location
  settings (`app-settings:` on iOS, `Linking.openSettings()` on Android).
  The `UserLocation` puck is not rendered, and `SpotDetailSheet` skips
  routing entirely (see § Routing above).

**Selecting a search result** overrides the camera the same way (`flyTo`,
zoom 14, 1 s) and marks the camera as already-centred so a late-resolving
GPS fix won't yank the view back to the user's position.

---

## Glyph Hosting

*(Added 2026-08-24.)* Root-caused a real bug: the "blank map" symptom from
earlier work wasn't fully fixed — it resurfaced as maps rendering tiles but
with **no text labels**. Device logs showed:

```
Failed to load glyph range 0-255 for font stack Noto Sans Regular:
(The request timed out.)
```

**Root cause, confirmed by inspecting the actual requested URL in device
logs** (not the template — the real, resolved request): MapLibre Native
was sending a corrupted URL for any font-stack name containing spaces —
`Noto Sans Regular` came out as `Noto Þ<garbage>ans20Regular`. This is a
client-side bug in `@maplibre/maplibre-react-native`'s glyph-URL
templating (matches a documented class of issue in the MapLibre ecosystem
— unencoded/mis-encoded spaces in `{fontstack}` substitution; see
`maplibre/martin#1443`), not something fixable from application code, and
**not primarily a Protomaps GitHub Pages reliability problem** — a plain
`curl` to the correctly-encoded URL from a terminal succeeded fast and
consistently; the corruption only happens inside MapLibre Native's own
request construction.

**Fix:** since we control both the style's font-stack references and
(once uploaded) our own hosted glyph file names, sidestep the bug
entirely by never sending a spaced font-stack name to MapLibre Native.
`src/lib/fonts.ts` renames the three fonts `protomaps-themes-base`
actually uses (`Noto Sans Regular/Medium/Italic` — confirmed via direct
inspection of the generated style, not assumed) to `NotoSansRegular` /
`NotoSansMedium` / `NotoSansItalic`, scoped to just each layer's
`layout['text-font']` (deliberately not a blanket string replace over the
whole layer — a first implementation attempt did that, and a test written
against it caught that it would also rename unrelated matching text
elsewhere in a layer; fixed before it shipped).

**Rollout is env-var-gated, not automatic:**

```ts
const CUSTOM_GLYPHS_URL = process.env.EXPO_PUBLIC_GLYPHS_URL;
const GLYPHS_URL = CUSTOM_GLYPHS_URL ?? 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
// ...
layers: CUSTOM_GLYPHS_URL
  ? withNoSpaceFontStacks(protomapsLayers('protomaps', 'light', 'de'))
  : protomapsLayers('protomaps', 'light', 'de'),
```

The rename only applies once `EXPO_PUBLIC_GLYPHS_URL` is set. Reason: the
Protomaps fallback hosts its files under the *original* spaced names —
renaming the style's font-stack references without a matching host would
break the fallback outright, not just leave it flaky. Until R2 is
populated, the fallback keeps today's (still bug-prone) behavior rather
than regressing to worse.

**Verified end-to-end, not just unit-tested:** couldn't upload to the
project's actual Cloudflare R2 bucket (no credentials/tooling — Cloudflare
API access, `wrangler`, `rclone`, and `aws` CLI are all unavailable in
this environment). Instead, stood up a throwaway local HTTP server serving
the renamed glyph files, pointed `EXPO_PUBLIC_GLYPHS_URL` at it, and
confirmed on a **freshly reinstalled** simulator build (to rule out
MapLibre's on-disk offline cache masking the result) that: labels render
correctly everywhere — streets, districts, parks, stations, with correct
German diacritics (ß, ü, ö) — and zero glyph errors in device logs. This
is real confirmation the fix mechanism works, not just that the unit
tests pass.

**Corrected 2026-08-24 — the file list below was wrong the first time
this section was written, and it was a real bug, not just an
incompleteness:** the original version of this section recommended
mirroring only 4 Latin ranges per font (12 files total) as "enough for
German + common Western European text." That assumption was wrong and
got caught by an actual device-log error from testing against the
verification mirror: `Failed to load glyph range 8192-8447 for font
stack NotoSansRegular` — range 8192-8447 is Unicode General Punctuation +
Currency Symbols (U+2000–U+20FF), needed for the € sign and typographic
quotes/dashes that show up in real German street/POI names, and it
wasn't in the 4-range set. Probed further and found **all 256 possible
ranges exist** for each font stack (the complete Basic Multilingual
Plane, 0–65535) — Germany-wide OSM data can't be assumed to stay within a
hand-picked Latin subset, since business/POI names include arbitrary
scripts and symbols. Downloaded and verified the complete set: **768
files (256 ranges × 3 fonts), ~13MB total** — small enough that
mirroring everything is strictly safer than guessing at a subset, and R2
has zero egress cost regardless of file count (this project's own hard
constraint). Mirror the complete set, not a curated one:

```bash
# Run for each of: "Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"
# (source names have spaces; destination path must not, to avoid the bug above)
for i in $(seq 0 255); do
  start=$((i * 256)); end=$((start + 255))
  curl -sf -o "NotoSansRegular/${start}-${end}.pbf" \
    "https://protomaps.github.io/basemaps-assets/fonts/Noto%20Sans%20Regular/${start}-${end}.pbf"
done
```

**Done (2026-09-26):** all 768 files uploaded to the `freipark-tiles`
bucket under `fonts/{NotoSansRegular,NotoSansMedium,NotoSansItalic}/{range}.pbf`
via the AWS CLI against R2's S3-compatible endpoint (256 objects per font,
verified via `aws s3 ls`). Spot-checked the public URL for range
`8192-8447` (the € / General Punctuation range that caused the earlier
scope-correction bug) — returns `200` with `content-type:
application/x-protobuf`. `frontend/.env` now sets:

```
EXPO_PUBLIC_GLYPHS_URL=https://pub-8560c232359c4bc7a276e8947b05b75b.r2.dev/fonts/{fontstack}/{range}.pbf
```

**On-device verification against the real R2 mirror — done (2026-09-26):**
built and ran the dev-client on iOS Simulator (iPhone 17, iOS 26.5) via
`npx expo run:ios`, with `frontend/.env`'s real `EXPO_PUBLIC_GLYPHS_URL`
(no local stand-in server this time). Confirmed on-screen over central
Berlin: all labels render correctly, including German diacritics —
`ß` (Wisbyer Straße, Danziger Straße, Skalitzer Straße, Yorckstraße,
Gneisenaustraße, Urbanstraße) and `ö` (Bremer Höhe). Device/Metro logs
show zero `Failed to load glyph range` errors for the full session. The
`[useSpots] RPC error` toast visible in this run is unrelated — this
sandbox can't resolve the live Supabase hostname — and is not a glyph or
map-rendering issue.

*(Hit and fixed one unrelated build blocker along the way:
`ios/.xcode.env.local` — untracked, local-only — pinned a stale Homebrew
node path from a prior node version; updated it to resolve `node`
dynamically via `command -v node` so it doesn't break on the next
Homebrew node upgrade.)*

The complete-set mirror already covers every script in the Basic
Multilingual Plane for these 3 fonts, so expanding to non-Latin-script
cities later needs no further glyph work. If a future city needs a font
weight `protomaps-themes-base` doesn't already use, that's a new entry in
`FONT_RENAME` (`src/lib/fonts.ts`) plus its own 256-file mirror — no
change to the URL template or rename mechanism itself.

---

## Code Style

Strict TypeScript (`"strict": true`). No `any`. All Supabase RPC responses
typed against an explicit local interface.

```tsx
// Preferred — typed props, no any
interface SpotDetailSheetProps {
  spot: SpotRow | null;
  onClose: () => void;
}

export function SpotDetailSheet({ spot, onClose }: SpotDetailSheetProps) {
  if (!spot) return null;
  // ...
}
```

One component per file. Feature folders own their own types; nothing bleeds
across feature boundaries except through `src/lib/`.

---

## Testing Strategy

**Unit tests** (`jest-expo` + `@testing-library/react-native` v14 — note:
`render()`/`renderHook()` — including `renderHook`'s returned `unmount()`
— are `async` in v14; every call site must `await` them, and fake-timer
tests should prefer `jest.advanceTimersByTimeAsync` over
`advanceTimersByTime` + a separate `act()` flush, which was a source of
test-order flakiness. `fireEvent.changeText`/`fireEvent.press` are also
async in this version — see `SPEC-auth.md` § Testing Strategy, found while
building the auth module; no map test uses `fireEvent` yet, but the next
one that does will hit this):
- `geo.test.ts` — bbox conversion helpers (pure functions, full coverage)
- `useSpots.test.ts` — mock Supabase client; assert query params and
  GeoJSON shape returned by the hook
- `SpotDetailSheet.test.tsx` — payment buttons render only for
  `access = 'paid'`; store URLs are correct strings

**Integration / E2E:** Out of scope for MVP. `SearchBar`/`useGeocoder` and
`RouteLayer`/`useRoute` have no dedicated tests yet — flagged as a gap, not
silently skipped.

**Coverage target:** ≥ 80% on `src/lib/` and `useSpots.ts`.
UI components: snapshot only.

**Actual coverage as of 2026-08-23** (`npx jest --coverage`):
`src/lib/` 100%; `useSpots.ts` 100% statements/lines/functions, 87.5%
branches — target met. `SpotDetailSheet.tsx` (66–71%) and `PaymentLinks.tsx`
(56%) sit well under 80%, but per this section's own testing strategy UI
components are snapshot-only and were never meant to hit the 80% bar — the
repo-wide average (77%) looks worse than the actual target compliance.

---

## Boundaries

**Always:**
- Run `npx jest` before committing frontend changes
- Use `EXPO_PUBLIC_*` prefix for any env var the JS bundle reads
- Type all `supabase.rpc()` return values — no untyped `data: any`
- Use `Linking.openURL` for all external links

**Ask first:**
- Adding a new npm dependency
- Changes to `supabase/migrations/` (new SQL, altering existing functions)
- Any change to `app.json` (bundle ID, permissions, SDK version)
- Adding or changing a third-party API call from the client (e.g. Nominatim)
  — it's outside our cost/uptime control even when free

**Never:**
- Commit `frontend/.env`
- Construct `easypark://`, `parknow://`, or any other unverified URI scheme
- Render all spots for a viewport at once beyond the RPC's own `LIMIT` —
  always use the viewport-bounded RPC
- Use the service role key on the frontend

---

## Success Criteria

1. ~~`npx expo start` → QR scannable with **Expo Go**~~ — **corrected:** MapLibre
   is a native module, so Expo Go cannot run this app (this contradicted M2's
   own task notes in `tasks/plan.md` even in the original spec). Use
   `npx expo run:ios` / `npx expo run:android` with `expo-dev-client` instead;
   map loads within 3 s on WiFi. **Met.**
2. Base map tiles render from R2 (`berlin.pmtiles`); network confirms `206 Partial Content`. **Met.**
3. Spot clusters visible after pan/zoom anywhere covered by a seeded city (30+ across Germany, not just Berlin). **Met.**
4. Tapping a cluster zooms in; tapping a single spot opens the bottom sheet. **Met.**
5. Bottom sheet shows correct type / access / operator for the tapped spot. **Met.**
6. Paid spots show EasyPark + ParkNow buttons; free spots do not. **Met.**
7. Tapping a payment button opens the correct App Store / Play Store page (manual device test). **Unverified — requires a manual device test, not automatable.**
8. `npx jest --coverage` passes with ≥ 80% on `src/lib/` and `useSpots.ts`. **Met** (see § Testing Strategy for exact numbers).
9. No per-request API cost introduced for anything FreiPark operates (search uses free third-party Nominatim — see § Search & Geocoding for the caveat). **Met.**
10. *(New)* Searching an address flies the camera there and it's queryable for spots. **Met.**
11. *(New)* Tapping a spot with a known user location shows a route summary (distance/duration) or a clear reason it's unavailable (loading / error / location denied). **Met.**

---

## Open Questions — Resolved

| Question | Decision |
|---|---|
| EasyPark deep link URI scheme? | No public scheme — use App Store / Play Store URLs |
| ParkNow deep link? | Same treatment; unconfirmed scheme → store URLs |
| Spot data transport? | Supabase JS anon client + `spots_in_bbox` RPC |
| All spots or viewport-bounded? | Viewport-bounded, LIMIT 2000 per query |
| Expo managed or bare? | Managed, SDK 57 |
| Platforms? | iOS + Android |
| Spot colour coding? | free=green, paid=blue, permit=amber, private=red, unknown=grey |
| *(New)* Geocoding provider? | Nominatim public API, client-side, Germany-filtered — free but third-party (§ Search & Geocoding) |
| *(New)* Turn-by-turn navigation, or route summary only? | Summary only (distance/duration + polyline); "Open in Maps" handles actual navigation |
| *(New)* Self-hosted or third-party routing engine? | Self-hosted OSRM via Docker Compose — zero per-call cost, matches the project's hard cost constraint (§ Routing, `SPEC-infra.md`) |
