#!/usr/bin/env python3
"""
FreiPark: roads under construction from OpenStreetMap into road_events
(SPEC-road-closures.md).

Reads the same cached Geofabrik state extracts as the parking import (one
per distinct cities.geofabrik_url — all 16 German states today) and keeps
`highway=construction` ways whose `construction=*` is a road cars use.
Mostly roads being built or rebuilt, not short repair closures.

Usage:
    python import_osm_construction.py
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterator
from zoneinfo import ZoneInfo

import psycopg2
from dotenv import load_dotenv

_HERE = Path(__file__).parent
_DATA = _HERE / "data"
BERLIN = ZoneInfo("Europe/Berlin")

# construction=* values for roads a driver could be on. Footways, paths,
# cycleways, steps, tracks, bridleways and pedestrian streets are left out,
# and so is a way with no construction value (there's no telling what it is).
CAR_ROADS = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link",
    "unclassified", "residential", "living_street", "service", "road",
})

_OPENING_DATE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")


def parse_opening_date(value: str) -> datetime | None:
    """OSM opening_date ("2027-05-14", "2027-05", "2027") → start of that date
    in German time; None if absent or not a real date."""
    m = _OPENING_DATE.match((value or "").strip())
    if not m:
        return None
    year, month, day = m.groups()
    try:
        return datetime(int(year), int(month or 1), int(day or 1), tzinfo=BERLIN)
    except ValueError:
        return None


def parse_way(feature: dict) -> dict | None:
    """One exported OSM feature → a road_events row, or None if it doesn't count."""
    props = feature.get("properties") or {}
    geometry = feature.get("geometry")
    if props.get("@type") != "way" or props.get("highway") != "construction":
        return None
    if props.get("construction") not in CAR_ROADS or not geometry:
        return None
    opening = parse_opening_date(props.get("opening_date", ""))
    name, ref = props.get("name"), props.get("ref")
    return {
        "source_id": f"way/{props.get('@id')}",
        "kind": "construction",
        "road": ref or name,
        "title": name or ref or "",
        "ends_at": opening.isoformat() if opening else None,
        "geom_json": json.dumps(geometry),
    }


def extract_files(geofabrik_urls: list[str]) -> list[str]:
    """Each extract once, in a stable order."""
    return sorted({Path(url).name for url in geofabrik_urls})


def _iter_features(path: Path) -> Iterator[dict]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.lstrip("\x1e").strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def read_extract(pbf: Path) -> list[dict]:
    """All qualifying ways in one state extract (intermediate files removed)."""
    filtered = _DATA / f"{pbf.stem}-construction.osm.pbf"
    seq = _DATA / f"{pbf.stem}-construction.geojsonseq"
    try:
        subprocess.run(["osmium", "tags-filter", str(pbf), "w/highway=construction",
                        "--overwrite", "-o", str(filtered)], check=True, capture_output=True)
        # The export config adds @type/@id to each feature (as in import_osm.py);
        # without it parse_way rejects everything and a real run finds 0 ways.
        subprocess.run(["osmium", "export", str(filtered), "-c", str(_HERE / "osmium-export-config.json"),
                        "--geometry-types=linestring", "--overwrite", "-f", "geojsonseq", "-o", str(seq)],
                       check=True, capture_output=True)
        return [e for f in _iter_features(seq) if (e := parse_way(f)) is not None]
    finally:
        filtered.unlink(missing_ok=True)
        seq.unlink(missing_ok=True)


_UPSERT_SQL = """
INSERT INTO road_events (source, source_id, kind, road, title, ends_at, geom, fetched_at)
VALUES ('osm', %(source_id)s, %(kind)s, %(road)s, %(title)s, %(ends_at)s,
        ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326), now())
ON CONFLICT (source, source_id) DO UPDATE SET
    kind = EXCLUDED.kind, road = EXCLUDED.road, title = EXCLUDED.title,
    ends_at = EXCLUDED.ends_at, geom = EXCLUDED.geom, fetched_at = now()
"""


def store(cur, events: list[dict], complete: bool) -> dict:
    """Upsert; remove OSM rows not in this import only if every extract was
    read (complete). Autobahn rows are never touched. Caller commits."""
    for event in events:
        cur.execute(_UPSERT_SQL, event)
    removed = 0
    if complete and events:
        cur.execute("DELETE FROM road_events WHERE source = 'osm' AND NOT (source_id = ANY(%s))",
                    ([e["source_id"] for e in events],))
        removed = cur.rowcount
    return {"upserted": len(events), "removed": removed}


def main() -> int:
    load_dotenv(_HERE.parent / ".env")
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("[osm-construction] DATABASE_URL not set", file=sys.stderr)
        return 1
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT geofabrik_url FROM cities")
        files = extract_files([row[0] for row in cur.fetchall()])

    events: dict[str, dict] = {}  # by source_id: border ways appear in two states
    complete = True
    for name in files:
        pbf = _DATA / name
        if not pbf.exists():
            print(f"  missing  {name} (run the parking import first)")
            complete = False
            continue
        try:
            found = read_extract(pbf)
        except subprocess.CalledProcessError as e:
            print(f"  FAILED   {name}: {e}")
            complete = False
            continue
        for event in found:
            events[event["source_id"]] = event
        print(f"  {name}: {len(found)} roads under construction")

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        stats = store(cur, list(events.values()), complete)
        conn.commit()
    print(f"[osm-construction] {len(files)} extracts, {len(events)} ways, removed {stats['removed']}"
          f"{'' if complete else ' (incomplete: nothing removed)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
