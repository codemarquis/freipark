#!/usr/bin/env python3
"""
FreiPark: fetch motorway roadworks and closures from the Autobahn API into
road_events (SPEC-road-closures.md).

Runs on the server every 30 minutes (cron, inside the api container). The
app never calls the Autobahn API; it reads road_events, so there is no
per-user cost.

Usage:
    python fetch_autobahn.py
"""

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import psycopg2
from dotenv import load_dotenv

BASE_URL = "https://verkehr.autobahn.de/o/autobahn"
USER_AGENT = "FreiPark/1.0 (road closures map; https://github.com/codemarquis/freipark)"
BERLIN = ZoneInfo("Europe/Berlin")

# Stale Autobahn rows are removed only after a sweep this successful, so an
# API outage or a bad half-hour can't wipe the map.
MIN_SUCCESS_RATE = 0.95

KIND_BY_TYPE = {
    "ROADWORKS": "roadworks",
    "SHORT_TERM_ROADWORKS": "short_term_roadworks",
    "CLOSURE": "closure",
    "CLOSURE_ENTRY_EXIT": "entry_exit_closure",
}
SERVICES = (("roadworks", "roadworks"), ("closure", "closure"))  # (path, response key)

# End-date formats seen in real descriptions (German local time):
#   "Ende: 21.10.26 um 16:00 Uhr"            end of the current phase
#   "12.10.26 von 10:00 bis 16:00 Uhr"       short-term windows → the latest "bis"
#   "(Ende der Gesamtmaßnahme: 09.10.26)"    whole project, date only → 23:59
_PHASE_END = re.compile(r"Ende:\s*(\d{2})\.(\d{2})\.(\d{2})(?:\s+um\s+(\d{1,2}):(\d{2}))?")
_WINDOW = re.compile(r"(\d{2})\.(\d{2})\.(\d{2})\s+von\s+\d{1,2}:\d{2}\s+bis\s+(\d{1,2}):(\d{2})")
_PROJECT_END = re.compile(r"Ende der Gesamtmaßnahme:\s*(\d{2})\.(\d{2})\.(\d{2})")


def _local(day: str, month: str, year: str, hour: str | None, minute: str | None) -> datetime | None:
    """A German local date/time, or None if it doesn't exist (e.g. 31.02.).
    "24:00" — common in the live data — means midnight starting the next day."""
    h = int(hour) if hour else 23
    m = int(minute) if minute else 59
    try:
        if h == 24 and m == 0:
            return datetime(2000 + int(year), int(month), int(day), tzinfo=BERLIN) + timedelta(days=1)
        return datetime(2000 + int(year), int(month), int(day), h, m, tzinfo=BERLIN)
    except ValueError:
        return None


def parse_end(description: list[str]) -> datetime | None:
    """When the event ends, from the free-text description; None if unknown."""
    for line in description:
        m = _PHASE_END.search(line)
        if m:
            return _local(*m.groups())
    windows = [w for line in description for d, mo, y, h, mi in _WINDOW.findall(line)
               if (w := _local(d, mo, y, h, mi)) is not None]
    if windows:
        return max(windows)
    for line in description:
        m = _PROJECT_END.search(line)
        if m:
            return _local(*m.groups(), None, None)
    return None


def parse_item(item: dict, road: str) -> dict | None:
    """One API item → a road_events row, or None if it isn't usable."""
    kind = KIND_BY_TYPE.get(item.get("display_type", ""))
    identifier, title, geometry = item.get("identifier"), item.get("title"), item.get("geometry")
    if not kind or not identifier or not title or not isinstance(geometry, dict) or not geometry.get("coordinates"):
        return None
    description = [line.strip() for line in item.get("description") or [] if isinstance(line, str)]
    ends_at = parse_end(description)
    return {
        "source_id": identifier,
        "kind": kind,
        "road": road,
        "title": title.strip(),
        "subtitle": (item.get("subtitle") or "").strip() or None,
        "description": [line for line in description if line],
        "starts_at": item.get("startTimestamp") or None,
        "ends_at": ends_at.isoformat() if ends_at else None,
        "geom_json": json.dumps(geometry),
    }


def clean_roads(roads: list[str]) -> list[str]:
    """The road list contains near-duplicates like "A60 " — trim and dedupe."""
    return sorted({r.strip() for r in roads if isinstance(r, str) and r.strip()})


@dataclass
class SweepResult:
    events: list[dict] = field(default_factory=list)
    requests: int = 0
    failed: int = 0
    skipped: int = 0  # items we couldn't read; never fatal to the sweep


def sweep(client: httpx.Client, pause: float = 0.2) -> SweepResult:
    """Every motorway's roadworks and closures. Failures are counted, not fatal."""
    result = SweepResult()
    roads = clean_roads(client.get("/").raise_for_status().json().get("roads", []))
    seen: set[str] = set()
    for road in roads:
        for path, key in SERVICES:
            result.requests += 1
            try:
                response = client.get(f"/{road}/services/{path}")
                response.raise_for_status()
                items = response.json().get(key, [])
            except (httpx.HTTPError, ValueError):
                result.failed += 1
                continue
            for item in items:
                try:
                    event = parse_item(item, road) if isinstance(item, dict) else None
                except Exception:  # one odd item must not cost the whole sweep
                    result.skipped += 1
                    continue
                if event and event["source_id"] not in seen:  # same item can appear under two roads
                    seen.add(event["source_id"])
                    result.events.append(event)
            time.sleep(pause)
    return result


_UPSERT_SQL = """
INSERT INTO road_events (source, source_id, kind, road, title, subtitle, description,
                         starts_at, ends_at, geom, fetched_at)
VALUES ('autobahn', %(source_id)s, %(kind)s, %(road)s, %(title)s, %(subtitle)s, %(description)s,
        %(starts_at)s, %(ends_at)s, ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326), now())
ON CONFLICT (source, source_id) DO UPDATE SET
    kind = EXCLUDED.kind, road = EXCLUDED.road, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
    description = EXCLUDED.description, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
    geom = EXCLUDED.geom, fetched_at = now()
"""


def store(cur, events: list[dict], requests: int, failed: int) -> dict:
    """Upsert this sweep's events; remove Autobahn rows it no longer saw, but
    only after a sweep with at least MIN_SUCCESS_RATE of requests succeeding.
    Runs in the caller's transaction; OSM rows are never touched."""
    for event in events:
        cur.execute(_UPSERT_SQL, event)
    removed = 0
    good_sweep = requests > 0 and (requests - failed) / requests >= MIN_SUCCESS_RATE
    if good_sweep and events:
        cur.execute(
            "DELETE FROM road_events WHERE source = 'autobahn' AND NOT (source_id = ANY(%s))",
            ([e["source_id"] for e in events],),
        )
        removed = cur.rowcount
    return {"upserted": len(events), "removed": removed, "good_sweep": good_sweep}


def main() -> int:
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("[autobahn] DATABASE_URL not set", file=sys.stderr)
        return 1
    started = time.time()
    with httpx.Client(base_url=BASE_URL, headers={"User-Agent": USER_AGENT}, timeout=30) as client:
        result = sweep(client)
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        stats = store(cur, result.events, result.requests, result.failed)
        conn.commit()
    kinds: dict[str, int] = {}
    for e in result.events:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"[autobahn] {datetime.now(BERLIN):%Y-%m-%d %H:%M} {result.requests} requests, {result.failed} failed, "
          f"{len(result.events)} events {kinds}, {result.skipped} unreadable, removed {stats['removed']}"
          f"{'' if stats['good_sweep'] else ' (poor sweep: nothing removed)'}, {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
