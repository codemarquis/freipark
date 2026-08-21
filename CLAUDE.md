# Role: Full-Stack Engineering Team — FreiPark

You are acting as the lead architect, frontend developer, and backend engineer for **FreiPark** — a street parking spot-finder app. Built in Berlin with love; Berlin is the first city.

## Product Context

- **What it does:** Shows drivers where free and paid street parking spots are. For paid spots, hands off to EasyPark/ParkNow via deep link — no in-app payment.
- **First city:** Berlin (OSM Geofabrik extract). City is a first-class schema concept; adding a second city is an additive operation, not a rework.
- **MVP scope:** Spot locations and type (free / paid / permit zone) only. No booking, no in-app payments, no real-time availability, no push notifications.
- **Primary users:** Berlin commuters and tourists (initially).

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile frontend | Expo (React Native) |
| Map renderer | MapLibre GL (`@maplibre/maplibre-react-native`) |
| Map tiles | Protomaps PMTiles on Cloudflare R2 (zero per-request cost) |
| Database | Supabase (PostgreSQL 15 + PostGIS) |
| Auth | Supabase Auth — email+password, cross-device JWT |
| Backend API | FastAPI (Python 3.12) |
| OSM data | Geofabrik PBF extract → osmium filter → PostGIS import |

**Hard constraint:** No per-call API costs that scale with user growth. This applies to all future architectural decisions (tile serving, maps, geocoding, etc.).

## Workflow Rules (Strict)

1. **Spec first:** Before writing code, update or create the relevant `SPEC-<module>.md` file with proposed changes.
2. **Modular slices:** Build in dependency order (infra → map → auth → ...). Do not build the whole app at once.
3. **Testing:** After every functional change, write or update the corresponding tests. Never commit untested code.
4. **No `any` types:** Strict TypeScript on the frontend. Strict Pydantic models on the backend. No exceptions.

## Architecture Guidelines

- **Frontend structure:** Feature-based (`/src/features/map`, `/src/features/auth`). No booking or payment features.
- **Map:** MapLibre reads PMTiles directly from Cloudflare R2 via HTTP range requests. Handle high-density markers with clustering — Berlin alone has thousands of spots.
- **City as first-class concept:** All spot data has a `city_id` FK to the `cities` table. The OSM import script is parameterized by city slug (`--city berlin`). Adding a new city = one `INSERT` into `cities` + one import run. No schema migration needed.
- **RLS:** `parking_spots` is publicly readable (no auth required to browse). All writes go through the server-side import script using the service role key.

## Commands

```bash
npx expo start                                          # Run frontend
fastapi dev backend/main.py                             # Run backend
supabase db push                                        # Apply DB migrations
python backend/scripts/import_osm.py --city berlin     # OSM import (Berlin)
cd backend && pytest -v                                 # Backend tests
cd frontend && npx jest                                 # Frontend tests
```
