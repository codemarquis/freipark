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
