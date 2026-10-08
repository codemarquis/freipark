"""Unit tests for the OSM import's feature → row mapping (no database).

Rule (SPEC-infra.md § OSM Import Pipeline → Which features become spots):
a feature becomes a row only if it matches the osmium filter itself —
amenity=parking / parking_space on any type, or parking:lane:* on a way.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_osm  # noqa: E402

POINT = {"type": "Point", "coordinates": [13.4, 52.5]}
LINE = {"type": "LineString", "coordinates": [[13.4, 52.5], [13.41, 52.5]]}


def feature(osm_type: str, tags: dict, geometry: dict = POINT) -> dict:
    return {"type": "Feature", "geometry": geometry, "properties": {"@type": osm_type, "@id": 42, **tags}}


@pytest.mark.parametrize("osm_type", ["node", "way", "relation"])
@pytest.mark.parametrize("amenity", ["parking", "parking_space"])
def test_car_parking_is_kept(osm_type, amenity):
    row = import_osm._feature_to_row(feature(osm_type, {"amenity": amenity}), "city")
    assert row is not None
    assert row["osm_type"] == osm_type


@pytest.mark.parametrize("kind", ["street_side", "lane", "on_kerb", "half_on_kerb", "shoulder"])
def test_street_parking_area_is_street_not_lot(kind):
    # How Berlin maps kerbside parking: 84k separate areas (SPEC-parking-rules.md).
    row = import_osm._feature_to_row(feature("way", {"amenity": "parking", "parking": kind}), "city")
    assert row["spot_type"] == "street"


@pytest.mark.parametrize("parking, expected", [
    ("surface", "lot"), (None, "lot"), ("multi-storey", "garage"), ("underground", "garage"), ("rooftop", "garage"),
])
def test_lots_and_garages_unchanged(parking, expected):
    tags = {"amenity": "parking", **({"parking": parking} if parking else {})}
    assert import_osm._feature_to_row(feature("way", tags), "city")["spot_type"] == expected


def test_a_street_parking_area_name_is_not_used_as_its_address():
    # The area's own name ("Parkstreifen Nord") is not a street; addresses for
    # these come from the nearest address/street, as before.
    row = import_osm._feature_to_row(
        feature("way", {"amenity": "parking", "parking": "street_side", "name": "Parkstreifen Nord"}), "city")
    assert row["spot_type"] == "street"
    assert row["address_source"] is None


def test_the_sql_and_python_street_kinds_agree():
    sql = (Path(__file__).resolve().parents[2] / "supabase/migrations/012_spot_rules.sql").read_text()
    for kind in import_osm.STREET_PARKING_KINDS:
        assert f"'{kind}'" in sql


@pytest.mark.parametrize("lane_tag", ["parking:lane:left", "parking:lane:right", "parking:lane:both"])
def test_street_parking_way_is_kept_as_street(lane_tag):
    row = import_osm._feature_to_row(feature("way", {lane_tag: "parallel", "highway": "residential"}, LINE), "city")
    assert row is not None
    assert row["spot_type"] == "street"


@pytest.mark.parametrize(
    "tags",
    [
        {"amenity": "parking_entrance"},
        {"amenity": "parking_exit"},
        {"amenity": "charging_station"},
        {"amenity": "bicycle_parking"},
        {"amenity": "waste_basket"},
        {"amenity": "atm"},
        {"barrier": "gate"},
        {"highway": "crossing", "crossing": "zebra"},
        {"entrance": "yes"},
        {"parking": "surface"},  # no amenity: not a car park on its own
    ],
)
@pytest.mark.parametrize("osm_type", ["node", "way"])
def test_referenced_objects_that_are_not_car_parking_are_skipped(tags, osm_type):
    assert import_osm._feature_to_row(feature(osm_type, tags), "city") is None


def test_parking_lane_tag_on_a_node_is_skipped():
    # The filter only selects ways for parking:lane:*; a tagged node is a
    # referenced vertex, not a street-parking stretch.
    assert import_osm._feature_to_row(feature("node", {"parking:lane:both": "parallel"}), "city") is None


def test_classification_is_unchanged_for_kept_features():
    row = import_osm._feature_to_row(
        feature("way", {"amenity": "parking", "parking": "multi-storey", "fee": "yes", "capacity": "120", "operator": "APCOA"}),
        "city",
    )
    assert row["spot_type"] == "garage"
    assert row["access"] == "paid"
    assert row["capacity"] == 120
    assert row["operator"] == "APCOA"


# --- Address rules 1-2 (SPEC-spot-address.md) -----------------------------

ADDRESS_KEYS = ("address_street", "address_housenumber", "address_postcode", "address_source", "address_distance_m")


def address(row: dict) -> tuple:
    return tuple(row[k] for k in ADDRESS_KEYS)


def test_own_address_tags_are_used():
    row = import_osm._feature_to_row(
        feature("way", {"amenity": "parking", "addr:street": "Oranienstraße", "addr:housenumber": "12",
                        "addr:postcode": "10997"}), "city")
    assert address(row) == ("Oranienstraße", "12", "10997", "own_tags", 0.0)


def test_own_street_without_number_still_counts():
    row = import_osm._feature_to_row(feature("node", {"amenity": "parking", "addr:street": "Oranienstraße"}), "city")
    assert address(row) == ("Oranienstraße", None, None, "own_tags", 0.0)


def test_street_parking_way_uses_its_own_name():
    row = import_osm._feature_to_row(
        feature("way", {"parking:lane:both": "parallel", "highway": "residential", "name": "Oranienstraße"}, LINE),
        "city")
    assert address(row) == ("Oranienstraße", None, None, "street_name", 0.0)


def test_own_address_tags_win_over_a_street_name():
    row = import_osm._feature_to_row(
        feature("way", {"parking:lane:left": "parallel", "name": "Oranienstraße", "addr:street": "Adalbertstraße",
                        "addr:housenumber": "3"}, LINE), "city")
    assert address(row)[:2] == ("Adalbertstraße", "3")
    assert address(row)[3] == "own_tags"


@pytest.mark.parametrize(
    "tags",
    [
        {"amenity": "parking"},
        {"amenity": "parking", "name": "P+R Ostkreuz"},  # a car park's name is not an address
        {"amenity": "parking", "addr:housenumber": "12"},  # a number without a street is not usable
        {"parking:lane:both": "parallel", "highway": "residential"},  # unnamed street
    ],
)
def test_no_own_address_leaves_all_fields_empty(tags):
    osm_type = "way" if any(k.startswith("parking:lane") for k in tags) else "node"
    row = import_osm._feature_to_row(feature(osm_type, tags, LINE if osm_type == "way" else POINT), "city")
    assert address(row) == (None, None, None, None, None)


# --- Address sources for rules 3-4 ------------------------------------------

def test_address_point_needs_street_and_number():
    assert import_osm._address_point(
        {"addr:street": "Oranienstraße", "addr:housenumber": "12", "addr:postcode": "10997"}
    ) == ("Oranienstraße", "12", "10997")
    assert import_osm._address_point({"addr:street": "Oranienstraße", "addr:housenumber": "12"}) == (
        "Oranienstraße", "12", None)
    assert import_osm._address_point({"addr:housenumber": "12"}) is None
    assert import_osm._address_point({"addr:street": "Oranienstraße"}) is None


@pytest.mark.parametrize("highway", ["residential", "primary", "tertiary", "living_street", "service", "unclassified"])
def test_named_car_streets_are_used(highway):
    assert import_osm._street_name({"highway": highway, "name": "Oranienstraße"}) == "Oranienstraße"


@pytest.mark.parametrize(
    "props",
    [
        {"highway": "footway", "name": "Uferweg"},
        {"highway": "cycleway", "name": "Radweg"},
        {"highway": "path", "name": "Waldweg"},
        {"highway": "steps", "name": "Treppe"},
        {"highway": "pedestrian", "name": "Fußgängerzone"},
        {"highway": "track", "name": "Feldweg"},
        {"highway": "residential"},  # unnamed
    ],
)
def test_streets_cars_cannot_use_or_without_a_name_are_ignored(props):
    assert import_osm._street_name(props) is None
