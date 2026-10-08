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

import io
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
    operator, capacity, location, geom, tags,
    address_street, address_housenumber, address_postcode, address_source, address_distance_m
)
VALUES (
    %(city_id)s, %(osm_id)s, %(osm_type)s, %(spot_type)s, %(access)s,
    %(operator)s, %(capacity)s,
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326)),
    ST_SetSRID(ST_GeomFromGeoJSON(%(geom_json)s), 4326),
    %(tags)s::jsonb,
    %(address_street)s, %(address_housenumber)s, %(address_postcode)s,
    %(address_source)s, %(address_distance_m)s
)
ON CONFLICT (osm_id, osm_type) DO UPDATE SET
    spot_type  = EXCLUDED.spot_type,
    access     = EXCLUDED.access,
    operator   = EXCLUDED.operator,
    capacity   = EXCLUDED.capacity,
    location   = EXCLUDED.location,
    geom       = EXCLUDED.geom,
    tags       = EXCLUDED.tags,
    -- Address (SPEC-spot-address.md): take the row's own address (rules
    -- 1-2) when it has one, or clear an own-tags/street-name address whose
    -- tags are gone; otherwise keep a nearest-rule address until the
    -- address step after the upsert refreshes it.
    address_street      = CASE WHEN (EXCLUDED.address_source IS NOT NULL OR parking_spots.address_source IN ('own_tags', 'street_name')) THEN EXCLUDED.address_street      ELSE parking_spots.address_street      END,
    address_housenumber = CASE WHEN (EXCLUDED.address_source IS NOT NULL OR parking_spots.address_source IN ('own_tags', 'street_name')) THEN EXCLUDED.address_housenumber ELSE parking_spots.address_housenumber END,
    address_postcode    = CASE WHEN (EXCLUDED.address_source IS NOT NULL OR parking_spots.address_source IN ('own_tags', 'street_name')) THEN EXCLUDED.address_postcode    ELSE parking_spots.address_postcode    END,
    address_distance_m  = CASE WHEN (EXCLUDED.address_source IS NOT NULL OR parking_spots.address_source IN ('own_tags', 'street_name')) THEN EXCLUDED.address_distance_m  ELSE parking_spots.address_distance_m  END,
    address_source      = CASE WHEN (EXCLUDED.address_source IS NOT NULL OR parking_spots.address_source IN ('own_tags', 'street_name')) THEN EXCLUDED.address_source      ELSE parking_spots.address_source      END,
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
    city_id, geofabrik_url, bbox = _fetch_city(dsn, city)

    _DATA.mkdir(exist_ok=True)
    # Key the raw PBF by URL filename so cities sharing a state extract
    # (e.g. munich + nuremberg → bayern-latest.osm.pbf) share one download.
    pbf_path   = _DATA / Path(geofabrik_url).name
    filtered   = _DATA / f"{city}-parking.osm.pbf"
    geojsonseq = _DATA / f"{city}-parking.geojsonseq"

    _download(geofabrik_url, pbf_path, force=force_download)

    if download_only:
        click.echo("[freipark-import] --download-only: stopping before filter/import")
        return

    if bbox is not None:
        area_pbf = _DATA / f"{city}-area.osm.pbf"
        _extract_bbox(pbf_path, area_pbf, bbox)
        source = area_pbf
    else:
        source = pbf_path

    _filter_osm(source, filtered)
    _export_geojson(filtered, geojsonseq)
    inserted, updated = _import_rows(dsn, city_id, geojsonseq)
    _assign_addresses(dsn, city, city_id, source)
    click.echo(f"[freipark-import] done — inserted={inserted}, updated={updated}")


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def _fetch_city(dsn: str, slug: str) -> tuple[str, str, tuple[float, float, float, float] | None]:
    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, geofabrik_url,
                   ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox)
            FROM cities WHERE slug = %s
            """,
            (slug,)
        )
        row = cur.fetchone()
    if row is None:
        raise click.ClickException(
            f"City '{slug}' not found in cities table — "
            "insert a row with the Geofabrik URL first"
        )
    bbox = (float(row[2]), float(row[3]), float(row[4]), float(row[5])) if row[2] is not None else None
    return row[0], row[1], bbox


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


def _extract_bbox(src: Path, dest: Path, bbox: tuple[float, float, float, float]) -> None:
    min_lon, min_lat, max_lon, max_lat = bbox
    click.echo(f"  extract  {src.name} → {dest.name} ({min_lon},{min_lat},{max_lon},{max_lat})")
    subprocess.run(
        [
            "osmium", "extract",
            "--bbox", f"{min_lon},{min_lat},{max_lon},{max_lat}",
            "--overwrite", "-o", str(dest), str(src),
        ],
        check=True,
        capture_output=True,
    )
    kb = dest.stat().st_size / 1_000
    click.echo(f"  extracted ({kb:.0f} KB)")


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


_CAR_PARKING_AMENITIES = ("parking", "parking_space")
_PARKING_LANE_TAGS = ("parking:lane:left", "parking:lane:right", "parking:lane:both")


def _is_parking_feature(osm_type: str, props: dict) -> bool:
    """True only for features that match _FILTERS themselves.

    osmium tags-filter also keeps every object the matches reference (a way
    needs its nodes), and osmium export emits any of those that has its own
    tags: barriers, crossings, garage entrances, charging stations, bins…
    Those are not parking spots. See SPEC-infra.md § OSM Import Pipeline.
    """
    if props.get("amenity") in _CAR_PARKING_AMENITIES:
        return True
    return osm_type == "way" and any(tag in props for tag in _PARKING_LANE_TAGS)


def _own_address(props: dict) -> dict:
    """Address rules 1-2 (SPEC-spot-address.md): the spot's own addr:* tags,
    else a street-parking way's own name (the street itself). Rules 3-4
    (nearest address point / named street) run after the upsert."""
    empty = {"address_street": None, "address_housenumber": None, "address_postcode": None,
             "address_source": None, "address_distance_m": None}
    if props.get("addr:street"):
        return {"address_street": props["addr:street"],
                "address_housenumber": props.get("addr:housenumber") or None,
                "address_postcode": props.get("addr:postcode") or None,
                "address_source": "own_tags", "address_distance_m": 0.0}
    if _spot_type(props) == "street" and props.get("name"):
        return {**empty, "address_street": props["name"], "address_source": "street_name",
                "address_distance_m": 0.0}
    return empty


def _feature_to_row(feature: dict, city_id: str) -> dict | None:
    props = feature.get("properties") or {}
    geom  = feature.get("geometry")
    if not geom or not props:
        return None

    osm_type = props.get("@type", "")
    osm_id_raw = props.get("@id")
    if osm_type not in ("node", "way", "relation") or osm_id_raw is None:
        return None
    if not _is_parking_feature(osm_type, props):
        return None
    osm_id = int(osm_id_raw)

    street_addr = _own_address(props)

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
        **street_addr,
    }


# ---------------------------------------------------------------------------
# Address rules 3-4 (SPEC-spot-address.md): nearest address point or named
# street within 60 m, worked out after each city's upsert from the same PBF.
# ---------------------------------------------------------------------------

_ADDRESS_MAX_M = 60

# Highways cars can't use: their names would mislead a driver.
_NON_CAR_HIGHWAYS = frozenset({
    "footway", "path", "cycleway", "steps", "bridleway", "track", "corridor",
    "pedestrian", "platform", "elevator", "proposed", "construction",
})

# Raw GeoJSON is COPYed into staging tables, then the compact final tables
# are *created* from them with the geometry already computed. Never UPDATE
# a temp table before indexing it in the same transaction: an index built
# over rows updated in this transaction can be unusable to it
# (pg_index.indcheckxmin), and the dead row versions double the table — on
# Berlin that turned each nearest lookup into a 3.4 GB sequential scan.
_ADDRESS_TEMP_TABLES_SQL = """
CREATE TEMP TABLE addr_points_raw (
    street text NOT NULL, housenumber text NOT NULL, postcode text, gj text NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE addr_streets_raw (name text NOT NULL, gj text NOT NULL) ON COMMIT DROP;
"""

_ADDRESS_PREPARE_SQL = """
CREATE TEMP TABLE addr_points ON COMMIT DROP AS
SELECT street, housenumber, postcode,
       ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(gj), 4326))::geometry(Point, 4326) AS geom
  FROM addr_points_raw;
CREATE TEMP TABLE addr_streets ON COMMIT DROP AS
SELECT name, ST_SetSRID(ST_GeomFromGeoJSON(gj), 4326)::geometry(Geometry, 4326) AS geom
  FROM addr_streets_raw;
DROP TABLE addr_points_raw, addr_streets_raw;
CREATE INDEX ON addr_points  USING gist (geom);
CREATE INDEX ON addr_streets USING gist (geom);
ANALYZE addr_points;
ANALYZE addr_streets;
"""

# Search box around each spot, in degrees. 0.0012° is >= 77 m east-west
# anywhere in Germany (47-55°N) and >= 133 m north-south, so it always
# contains the 60 m radius. The "&&" box filter guarantees a GiST index
# lookup per spot: without it, on real Berlin data (451k address points)
# the planner chose a full scan + sort per spot and one city took hours.
_ADDRESS_SEARCH_DEG = 0.0012

# Two steps for the whole city (both in the caller's transaction):
#   1. search: each spot's nearest address point / named street into a small
#      temp table. Candidates come from the box; "<->" ranks them; the exact
#      distance is then measured in metres on the geography.
#   2. write: update parking_spots only where the result differs. Each row
#      carries its full OSM tags and geometry, so rewriting all of a city's
#      spots on every import was what made the first version take hours.
# Only spots without an own address (rules 1-2) are considered; a stale
# nearest-rule address is replaced or cleared. No candidate gives a NULL
# distance, and NULL <= 60 is not true, so it falls through.
_ASSIGN_ADDRESSES_SQL = f"""
DROP TABLE IF EXISTS addr_assign;
CREATE TEMP TABLE addr_assign ON COMMIT DROP AS
SELECT ps.id,
       CASE WHEN a.d <= {_ADDRESS_MAX_M} THEN a.street
            WHEN s.d <= {_ADDRESS_MAX_M} THEN s.name END                          AS street,
       CASE WHEN a.d <= {_ADDRESS_MAX_M} THEN a.housenumber END                   AS housenumber,
       CASE WHEN a.d <= {_ADDRESS_MAX_M} THEN a.postcode END                      AS postcode,
       CASE WHEN a.d <= {_ADDRESS_MAX_M} THEN 'nearest_address'
            WHEN s.d <= {_ADDRESS_MAX_M} THEN 'nearest_street' END                AS source,
       CASE WHEN a.d <= {_ADDRESS_MAX_M} THEN a.d
            WHEN s.d <= {_ADDRESS_MAX_M} THEN s.d END::real                       AS distance_m
  FROM parking_spots ps
  LEFT JOIN LATERAL (
      SELECT ap.street, ap.housenumber, ap.postcode,
             ST_Distance(ps.location::geography, ap.geom::geography) AS d
        FROM addr_points ap
       WHERE ap.geom && ST_Expand(ps.location, {_ADDRESS_SEARCH_DEG})
       ORDER BY ap.geom <-> ps.location LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
      SELECT st.name, ST_Distance(ps.location::geography, st.geom::geography) AS d
        FROM addr_streets st
       WHERE st.geom && ST_Expand(ps.location, {_ADDRESS_SEARCH_DEG})
       ORDER BY st.geom <-> ps.location LIMIT 1
  ) s ON true
 WHERE ps.city_id = %(city_id)s
   AND (ps.address_source IS NULL OR ps.address_source IN ('nearest_address', 'nearest_street'));

UPDATE parking_spots ps SET
    address_street      = n.street,
    address_housenumber = n.housenumber,
    address_postcode    = n.postcode,
    address_source      = n.source,
    address_distance_m  = n.distance_m
  FROM addr_assign n
 WHERE ps.id = n.id
   AND (ps.address_street, ps.address_housenumber, ps.address_postcode, ps.address_source, ps.address_distance_m)
       IS DISTINCT FROM (n.street, n.housenumber, n.postcode, n.source, n.distance_m);
"""


def _address_point(props: dict) -> tuple[str, str, str | None] | None:
    """An OSM address usable for "near Street No": needs a street and a number."""
    street, number = props.get("addr:street"), props.get("addr:housenumber")
    if not street or not number:
        return None
    return street, number, props.get("addr:postcode") or None


def _street_name(props: dict) -> str | None:
    """A named street a driver could be on; None for footways, paths, etc."""
    name, highway = props.get("name"), props.get("highway")
    if not name or not highway or highway in _NON_CAR_HIGHWAYS:
        return None
    return name


def _copy_text(value: str | None) -> str:
    if value is None:
        return "\\N"
    return value.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")


def _assign_addresses(dsn: str, city: str, city_id: str, source: Path) -> None:
    """Rules 3-4 for one city, from the same (bbox-clipped) PBF as the spots.
    Address points and streets live only in temp tables for this run."""
    points_pbf = _DATA / f"{city}-addr-points.osm.pbf"
    streets_pbf = _DATA / f"{city}-addr-streets.osm.pbf"
    points_seq = _DATA / f"{city}-addr-points.geojsonseq"
    streets_seq = _DATA / f"{city}-addr-streets.geojsonseq"
    for expr, pbf, seq, types in (
        ("nwr/addr:housenumber", points_pbf, points_seq, "point,polygon,multipolygon"),
        ("w/highway", streets_pbf, streets_seq, "linestring"),
    ):
        subprocess.run(["osmium", "tags-filter", str(source), expr, "--overwrite", "-o", str(pbf)],
                       check=True, capture_output=True)
        subprocess.run(["osmium", "export", str(pbf), f"--geometry-types={types}", "--overwrite",
                        "-f", "geojsonseq", "-o", str(seq)], check=True, capture_output=True)

    points, streets = io.StringIO(), io.StringIO()
    n_points = n_streets = 0
    for feat in _iter_features(points_seq):
        hit = _address_point(feat.get("properties") or {})
        if hit and feat.get("geometry"):
            street, number, postcode = hit
            points.write("\t".join(_copy_text(v) for v in (street, number, postcode, json.dumps(feat["geometry"]))) + "\n")
            n_points += 1
    for feat in _iter_features(streets_seq):
        name = _street_name(feat.get("properties") or {})
        if name and feat.get("geometry"):
            streets.write("\t".join(_copy_text(v) for v in (name, json.dumps(feat["geometry"]))) + "\n")
            n_streets += 1
    points.seek(0)
    streets.seek(0)
    # Recreated on every import; Berlin's alone are ~380 MB.
    for leftover in (points_pbf, streets_pbf, points_seq, streets_seq):
        leftover.unlink(missing_ok=True)

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        # A runaway step must die in Postgres, not live on orphaned if this
        # process goes away (it did: hours, after the Mac slept mid-run).
        cur.execute("SET LOCAL statement_timeout = '15min'")
        cur.execute(_ADDRESS_TEMP_TABLES_SQL)
        cur.copy_from(points, "addr_points_raw", columns=("street", "housenumber", "postcode", "gj"))
        cur.copy_from(streets, "addr_streets_raw", columns=("name", "gj"))
        cur.execute(_ADDRESS_PREPARE_SQL)
        cur.execute(_ASSIGN_ADDRESSES_SQL, {"city_id": city_id})
        cur.execute(
            "SELECT coalesce(address_source, 'none'), count(*) FROM parking_spots "
            "WHERE city_id = %s GROUP BY 1 ORDER BY 1", (city_id,)
        )
        counts = ", ".join(f"{source}={n}" for source, n in cur.fetchall())
        conn.commit()  # temp tables drop here
    click.echo(f"  address  {n_points} address points, {n_streets} named streets → {counts}")


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
