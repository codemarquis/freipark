#!/usr/bin/env python3
"""
FreiPark OSM import pipeline.

Downloads a Geofabrik PBF extract for a city, filters it to parking features
using osmium-tool, exports to GeoJSON, then bulk-upserts into parking_spots.

Usage:
    python import_osm.py --city berlin
    python import_osm.py --city berlin --force-download
    python import_osm.py --city berlin --download-only
"""

import json
import os
import subprocess
import urllib.request
from pathlib import Path
from typing import Iterator

import click
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

_HERE = Path(__file__).parent
_DATA = _HERE / "data"

load_dotenv(_HERE.parent / ".env")

# osmium tags-filter expressions for parking features.
# Covers lots/garages (amenity=parking), individual spaces, and street lanes.
_FILTERS = [
    "nwr/amenity=parking",
    "nwr/amenity=parking_space",
    "w/parking:lane:left",
    "w/parking:lane:right",
    "w/parking:lane:both",
]

_UPSERT_SQL = """
INSERT INTO parking_spots (
    city_id, osm_id, osm_type, spot_type, access,
    operator, capacity, location, geom, tags
)
VALUES (
    %(city_id)s, %(osm_id)s, %(osm_type)s, %(spot_type)s, %(access)s,
    %(operator)s, %(capacity)s,
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326)),
    ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326),
    %(tags)s::jsonb
)
ON CONFLICT (osm_id, osm_type) DO UPDATE SET
    spot_type  = EXCLUDED.spot_type,
    access     = EXCLUDED.access,
    operator   = EXCLUDED.operator,
    capacity   = EXCLUDED.capacity,
    location   = EXCLUDED.location,
    geom       = EXCLUDED.geom,
    tags       = EXCLUDED.tags,
    updated_at = NOW()
"""


@click.command()
@click.option("--city", required=True, help="City slug matching cities.slug (e.g. berlin)")
@click.option("--force-download", is_flag=True, help="Re-download PBF even if cached")
@click.option("--download-only", is_flag=True, help="Download PBF and stop — skip filter/import")
def main(city: str, force_download: bool, download_only: bool) -> None:
    """Import OSM parking features for CITY into parking_spots."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise click.ClickException("DATABASE_URL not set — check backend/.env")

    click.echo(f"[freipark-import] city={city}")
    city_id, geofabrik_url = _fetch_city(dsn, city)

    _DATA.mkdir(exist_ok=True)
    pbf_path   = _DATA / f"{city}.osm.pbf"
    filtered   = _DATA / f"{city}-parking.osm.pbf"
    geojsonseq = _DATA / f"{city}-parking.geojsonseq"

    _download(geofabrik_url, pbf_path, force=force_download)

    if download_only:
        click.echo("[freipark-import] --download-only: stopping before filter/import")
        return

    _filter_osm(pbf_path, filtered)
    _export_geojson(filtered, geojsonseq)
    inserted, updated = _import_rows(dsn, city_id, geojsonseq)
    click.echo(f"[freipark-import] done — inserted={inserted}, updated={updated}")


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def _fetch_city(dsn: str, slug: str) -> tuple[str, str]:
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id::text, geofabrik_url FROM cities WHERE slug = %s", (slug,)
        )
        row = cur.fetchone()
    if row is None:
        raise click.ClickException(
            f"City '{slug}' not found in cities table — "
            "insert a row with the Geofabrik URL first"
        )
    return row[0], row[1]


def _download(url: str, dest: Path, *, force: bool) -> None:
    if dest.exists() and not force:
        mb = dest.stat().st_size / 1_000_000
        click.echo(f"  cached   {dest.name} ({mb:.0f} MB)")
        return

    click.echo(f"  download {url}")

    def _progress(count: int, block_size: int, total: int) -> None:
        if total > 0 and count % 200 == 0:
            pct = min(100, count * block_size * 100 // total)
            click.echo(f"\r  ...{pct}%", nl=False)

    urllib.request.urlretrieve(url, dest, reporthook=_progress)
    click.echo()
    mb = dest.stat().st_size / 1_000_000
    click.echo(f"  saved    {dest.name} ({mb:.0f} MB)")


def _filter_osm(src: Path, dest: Path) -> None:
    click.echo(f"  filter   {src.name} → {dest.name}")
    subprocess.run(
        ["osmium", "tags-filter", str(src), *_FILTERS, "--overwrite", "-o", str(dest)],
        check=True,
        capture_output=True,
    )
    kb = dest.stat().st_size / 1_000
    click.echo(f"  filtered ({kb:.0f} KB)")


def _export_geojson(src: Path, dest: Path) -> None:
    click.echo(f"  export   {src.name} → {dest.name}")
    config = _HERE / "osmium-export-config.json"
    subprocess.run(
        [
            "osmium", "export", str(src),
            "-c", str(config),
            "--geometry-types=point,linestring,polygon,multipolygon",
            "--overwrite",
            "-f", "geojsonseq",
            "-o", str(dest),
        ],
        check=True,
        capture_output=True,
    )


def _iter_features(path: Path) -> Iterator[dict]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.lstrip("\x1e").strip()  # strip GeoJSON-seq RS record separator
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                pass


def _spot_type(props: dict) -> str:
    if any(k.startswith("parking:lane") for k in props):
        return "street"
    if props.get("parking") in ("multi-storey", "underground", "rooftop"):
        return "garage"
    return "lot"


def _access(props: dict) -> str | None:
    if props.get("fee") == "yes" or props.get("charge"):
        return "paid"
    if props.get("fee") == "no":
        return "free"
    access_tag = props.get("access", "")
    if access_tag in ("permit", "residents"):
        return "permit"
    if access_tag == "private":
        return "private"
    return None


def _feature_to_row(feature: dict, city_id: str) -> dict | None:
    props = feature.get("properties") or {}
    geom  = feature.get("geometry")
    if not geom or not props:
        return None

    osm_type = props.get("@type", "")
    osm_id_raw = props.get("@id")
    if osm_type not in ("node", "way", "relation") or osm_id_raw is None:
        return None
    osm_id = int(osm_id_raw)

    cap_raw  = props.get("capacity", "")
    capacity = int(cap_raw) if isinstance(cap_raw, str) and cap_raw.isdigit() else None

    return {
        "city_id":   city_id,
        "osm_id":    osm_id,
        "osm_type":  osm_type,
        "spot_type": _spot_type(props),
        "access":    _access(props),
        "operator":  props.get("operator") or props.get("brand"),
        "capacity":  capacity,
        "geom_json": json.dumps(geom),
        "tags":      json.dumps({k: v for k, v in props.items() if not k.startswith("@")}),
    }


def _import_rows(dsn: str, city_id: str, path: Path) -> tuple[int, int]:
    rows: list[dict] = []
    skipped = 0
    for feat in _iter_features(path):
        row = _feature_to_row(feat, city_id)
        if row is None:
            skipped += 1
        else:
            rows.append(row)

    click.echo(f"  parsed   {len(rows)} features ({skipped} skipped)")

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM parking_spots WHERE city_id = %s", (city_id,)
        )
        count_before: int = cur.fetchone()[0]

        psycopg2.extras.execute_batch(cur, _UPSERT_SQL, rows, page_size=500)
        conn.commit()

        cur.execute(
            "SELECT count(*) FROM parking_spots WHERE city_id = %s", (city_id,)
        )
        count_after: int = cur.fetchone()[0]

    inserted = count_after - count_before
    updated  = max(0, len(rows) - inserted)
    return inserted, updated


if __name__ == "__main__":
    main()
