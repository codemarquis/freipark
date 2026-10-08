"""Tests for backend/scripts/import_osm_construction.py (SPEC-road-closures.md).

Unit tests need no database; storing tests go through `write_tx`
(local only, rolled back).
"""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_osm_construction as oc  # noqa: E402
from tests.conftest import act_as  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")
LINE = {"type": "LineString", "coordinates": [[13.40, 52.50], [13.41, 52.50]]}


def way(way_id=42, geometry=LINE, **tags):
    return {"type": "Feature", "geometry": geometry,
            "properties": {"@type": "way", "@id": way_id, "highway": "construction", **tags}}


# --- Which ways count -----------------------------------------------------------

@pytest.mark.parametrize("construction", [
    "motorway", "motorway_link", "trunk", "primary", "secondary_link", "tertiary",
    "unclassified", "residential", "living_street", "service", "road",
])
def test_car_roads_under_construction_are_kept(construction):
    event = oc.parse_way(way(construction=construction))
    assert event is not None
    assert event["kind"] == "construction"
    assert event["source_id"] == "way/42"


@pytest.mark.parametrize("construction", ["footway", "path", "cycleway", "steps", "track", "bridleway", "pedestrian"])
def test_ways_cars_cannot_use_are_dropped(construction):
    assert oc.parse_way(way(construction=construction)) is None


def test_a_way_without_a_construction_value_is_dropped():
    assert oc.parse_way(way()) is None


def test_non_construction_highways_and_nodes_are_dropped():
    feature = way(construction="primary")
    feature["properties"]["highway"] = "primary"
    assert oc.parse_way(feature) is None
    node = way(construction="primary")
    node["properties"]["@type"] = "node"
    assert oc.parse_way(node) is None


def test_a_way_without_geometry_is_dropped():
    assert oc.parse_way(way(geometry=None, construction="primary")) is None


# --- Fields ---------------------------------------------------------------------

def test_title_prefers_name_then_ref():
    assert oc.parse_way(way(construction="primary", name="Oranienstraße", ref="B96"))["title"] == "Oranienstraße"
    assert oc.parse_way(way(construction="trunk", ref="B96"))["title"] == "B96"
    assert oc.parse_way(way(construction="residential"))["title"] == ""


def test_road_is_the_ref_or_name():
    assert oc.parse_way(way(construction="motorway", ref="A 100", name="Stadtring"))["road"] == "A 100"
    assert oc.parse_way(way(construction="residential", name="Ackerstraße"))["road"] == "Ackerstraße"


def test_geometry_is_kept_as_geojson():
    assert json.loads(oc.parse_way(way(construction="primary"))["geom_json"]) == LINE


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2027-05-14", datetime(2027, 5, 14, tzinfo=BERLIN)),
        ("2027-05", datetime(2027, 5, 1, tzinfo=BERLIN)),
        ("2027", datetime(2027, 1, 1, tzinfo=BERLIN)),
        ("spring 2027", None),
        ("2027-13-01", None),
        ("", None),
    ],
)
def test_opening_date_becomes_the_end(value, expected):
    assert oc.parse_opening_date(value) == expected


def test_opening_date_is_stored_as_ends_at():
    event = oc.parse_way(way(construction="primary", opening_date="2027-05-14"))
    assert event["ends_at"] == datetime(2027, 5, 14, tzinfo=BERLIN).isoformat()


# --- Extract list ------------------------------------------------------------------

def test_extract_names_come_from_geofabrik_urls_once_each():
    urls = [
        "https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf",
        "https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf",
        "https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf",
    ]
    assert oc.extract_files(urls) == ["bayern-latest.osm.pbf", "berlin-latest.osm.pbf"]


# --- Storing (DB) -----------------------------------------------------------------

@pytest.fixture
def db(write_tx):
    act_as(write_tx, "admin")
    write_tx.execute("DELETE FROM road_events WHERE source = 'osm'")  # rolled back afterwards
    write_tx.execute(
        "INSERT INTO road_events (source, source_id, kind, title, geom) VALUES ('autobahn', 'ab-test-1', "
        "'roadworks', 'A100 | test', ST_SetSRID(ST_MakeLine(ST_MakePoint(13.3, 52.5), ST_MakePoint(13.31, 52.5)), 4326))"
    )
    return write_tx


def osm_rows(cur):
    cur.execute("SELECT source_id, title FROM road_events WHERE source = 'osm' ORDER BY source_id")
    return cur.fetchall()


def test_store_inserts_and_updates_in_place(db):
    oc.store(db, [oc.parse_way(way(1, construction="primary", name="Alt"))], complete=True)
    oc.store(db, [oc.parse_way(way(1, construction="primary", name="Neu"))], complete=True)
    assert osm_rows(db) == [("way/1", "Neu")]


def test_ways_gone_from_a_complete_import_are_removed(db):
    oc.store(db, [oc.parse_way(way(1, construction="primary")), oc.parse_way(way(2, construction="primary"))],
             complete=True)
    stats = oc.store(db, [oc.parse_way(way(1, construction="primary"))], complete=True)
    assert stats["removed"] == 1
    assert [r[0] for r in osm_rows(db)] == ["way/1"]


def test_nothing_is_removed_after_an_incomplete_import(db):
    oc.store(db, [oc.parse_way(way(1, construction="primary")), oc.parse_way(way(2, construction="primary"))],
             complete=True)
    stats = oc.store(db, [oc.parse_way(way(1, construction="primary"))], complete=False)
    assert stats["removed"] == 0
    assert [r[0] for r in osm_rows(db)] == ["way/1", "way/2"]


def test_autobahn_rows_are_never_touched(db):
    oc.store(db, [oc.parse_way(way(1, construction="primary"))], complete=True)
    db.execute("SELECT count(*) FROM road_events WHERE source = 'autobahn' AND source_id = 'ab-test-1'")
    assert db.fetchone()[0] == 1


# --- The real osmium pipeline (regression) ------------------------------------

TINY_OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="freipark-test">
  <node id="1" lat="52.500" lon="13.400" version="1"/>
  <node id="2" lat="52.500" lon="13.410" version="1"/>
  <node id="3" lat="52.501" lon="13.400" version="1"/>
  <node id="4" lat="52.501" lon="13.410" version="1"/>
  <way id="100" version="1">
    <nd ref="1"/><nd ref="2"/>
    <tag k="highway" v="construction"/><tag k="construction" v="primary"/>
    <tag k="name" v="Teststraße"/><tag k="opening_date" v="2027-05-14"/>
  </way>
  <way id="101" version="1">
    <nd ref="3"/><nd ref="4"/>
    <tag k="highway" v="construction"/><tag k="construction" v="footway"/>
  </way>
</osm>
"""


@pytest.mark.skipif(not __import__("shutil").which("osmium"), reason="osmium not installed")
def test_read_extract_runs_the_real_osmium_pipeline(tmp_path, monkeypatch):
    """Regression: osmium export only emits @type/@id with the export config;
    without it every feature was rejected and a real run found 0 ways."""
    monkeypatch.setattr(oc, "_DATA", tmp_path)
    source = tmp_path / "tiny.osm"
    source.write_text(TINY_OSM, encoding="utf-8")
    pbf = tmp_path / "tiny-latest.osm.pbf"
    __import__("subprocess").run(["osmium", "cat", str(source), "-o", str(pbf), "--overwrite"], check=True)
    events = oc.read_extract(pbf)
    assert [(e["source_id"], e["title"]) for e in events] == [("way/100", "Teststraße")]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["tiny-latest.osm.pbf", "tiny.osm"]  # intermediates gone
