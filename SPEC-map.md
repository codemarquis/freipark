# Spec: Map Module

## Objective

Render a live, interactive map of Berlin parking spots using the tile data
already served from Cloudflare R2 (`berlin.pmtiles`) and the 65 k spot
records already in Supabase.

**User story:** A driver opens FreiPark, sees a map centred on Berlin with
colour-coded parking markers, scrolls/zooms freely, taps a spot to read its
type and access rules, and — for paid spots — gets a button that opens the
EasyPark or ParkNow App Store listing so they can download the payment app.

**Success looks like:** A real device (or simulator) showing clustered
Berlin parking spots, rendered from live DB data, with zero per-tile or
per-request API costs.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Expo SDK 53, managed workflow | No bare eject; OTA updates |
| Navigation | Expo Router (file-based) | Single screen for now |
| Map renderer | `@maplibre/maplibre-react-native` ^10 | OSS, zero tile-API cost |
| Tile source | Protomaps PMTiles on Cloudflare R2 | HTTP range requests, zero egress |
| Spot data | `@supabase/supabase-js` v2, anon key | RLS already set to public read |
| Spot query | PostgREST RPC `spots_in_bbox` | New migration (002); returns ≤ 2000 pts |
| Bottom sheet | `@gorhom/bottom-sheet` v5 | Industry-standard RN bottom sheet |
| Linking | `expo-linking` | App Store / Play Store URLs only |

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
  app/
    _layout.tsx           → Root Expo Router layout (safe area, theme)
    index.tsx             → Entry point — renders <MapScreen />
  src/
    features/
      map/
        MapScreen.tsx     → Full-screen MapLibre map, wires layers + sheet
        SpotLayer.tsx     → GeoJSON source, cluster layers, circle layers
        SpotDetailSheet.tsx → Bottom sheet: spot info + payment CTA
        useSpots.ts       → Hook: calls spots_in_bbox on viewport change
      payments/
        PaymentLinks.tsx  → EasyPark / ParkNow App Store link buttons
    lib/
      supabase.ts         → Supabase JS singleton (anon key)
      geo.ts              → Bbox helpers (MapLibre bounds → lon/lat tuple)
  __tests__/
    useSpots.test.ts
    geo.test.ts
    SpotDetailSheet.test.tsx
  assets/                 → App icon, splash
  app.json
  package.json
  tsconfig.json
  .env                    → GITIGNORED — real keys
  .env.example            → Already committed
```

```
supabase/
  migrations/
    001_initial_schema.sql   → Already applied
    002_spots_in_bbox.sql    → New: RPC function for map queries
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

---

## Initial Camera

Centre: `{ lon: 13.4050, lat: 52.5200 }` (Berlin Mitte), zoom 13.

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

**Unit tests** (`jest` + `@testing-library/react-native`):
- `geo.test.ts` — bbox conversion helpers (pure functions, full coverage)
- `useSpots.test.ts` — mock Supabase client; assert query params and
  GeoJSON shape returned by the hook
- `SpotDetailSheet.test.tsx` — payment buttons render only for
  `access = 'paid'`; store URLs are correct strings

**Integration / E2E:** Out of scope for MVP. Mark with `// TODO: E2E` stubs.

**Coverage target:** ≥ 80% on `src/lib/` and `useSpots.ts`.
UI components: snapshot only.

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

**Never:**
- Commit `frontend/.env`
- Construct `easypark://`, `parknow://`, or any other unverified URI scheme
- Render all 65 k spots at once — always use the viewport-bounded RPC
- Use the service role key on the frontend

---

## Success Criteria

1. `npx expo start` → QR scannable with Expo Go; map loads within 3 s on WiFi
2. Base map tiles render from R2 (`berlin.pmtiles`); network confirms `206 Partial Content`
3. Spot clusters visible after pan/zoom anywhere in Berlin
4. Tapping a cluster zooms in; tapping a single spot opens the bottom sheet
5. Bottom sheet shows correct type / access / operator for the tapped spot
6. Paid spots show EasyPark + ParkNow buttons; free spots do not
7. Tapping a payment button opens the correct App Store / Play Store page (manual device test)
8. `npx jest --coverage` passes with ≥ 80% on `src/lib/` and `useSpots.ts`
9. No per-request API cost introduced

---

## Open Questions — Resolved

| Question | Decision |
|---|---|
| EasyPark deep link URI scheme? | No public scheme — use App Store / Play Store URLs |
| ParkNow deep link? | Same treatment; unconfirmed scheme → store URLs |
| Spot data transport? | Supabase JS anon client + `spots_in_bbox` RPC |
| All spots or viewport-bounded? | Viewport-bounded, LIMIT 2000 per query |
| Expo managed or bare? | Managed, SDK 53 |
| Platforms? | iOS + Android |
| Spot colour coding? | free=green, paid=blue, permit=amber, private=red, unknown=grey |
