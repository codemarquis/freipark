"""DB tests for spot addresses (SPEC-spot-address.md; migration 010).

Every test writes, so every test goes through `write_tx`: local database
only, opt-in via FREIPARK_DB_WRITE_TESTS=1, always rolled back.
"""
import uuid

import pytest

from tests.conftest import act_as
from tests.test_spot_reports import expect_error

ADDRESS_COLUMNS = ["address_street", "address_housenumber", "address_postcode", "address_source", "city_name"]
SPOT_DETAILS = "SELECT * FROM spot_details(%s)"


@pytest.fixture
def spots(write_tx):
    """Two Berlin test spots: one with a full address, one with none."""
    cur = write_tx
    act_as(cur, "admin")
    cur.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    city_id = cur.fetchone()[0]
    ids = {}
    for i, (key, address) in enumerate(
        [
            ("with_address", ("Oranienstraße", "12", "10997", "nearest_address", 18.5)),
            ("without_address", (None, None, None, None, None)),
        ]
    ):
        cur.execute(
            """
            INSERT INTO parking_spots (city_id, osm_id, osm_type, source, spot_type, access, location,
                                       address_street, address_housenumber, address_postcode,
                                       address_source, address_distance_m)
            VALUES (%s, %s, 'node', 'test', 'lot', 'free', ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326),
                    %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (city_id, -910_000_000 - i, *address),
        )
        ids[key] = str(cur.fetchone()[0])
    return {"cur": cur, **ids}


def test_spot_details_returns_the_address_and_city(spots):
    cur = spots["cur"]
    act_as(cur, "anon")
    cur.execute(SPOT_DETAILS, (spots["with_address"],))
    assert [d.name for d in cur.description] == ADDRESS_COLUMNS
    assert cur.fetchall() == [("Oranienstraße", "12", "10997", "nearest_address", "Berlin")]


def test_spot_details_returns_nulls_for_a_spot_without_an_address(spots):
    cur = spots["cur"]
    act_as(cur, "anon")
    cur.execute(SPOT_DETAILS, (spots["without_address"],))
    assert cur.fetchall() == [(None, None, None, None, "Berlin")]


def test_spot_details_returns_no_row_for_an_unknown_spot(spots):
    cur = spots["cur"]
    act_as(cur, "anon")
    cur.execute(SPOT_DETAILS, (str(uuid.uuid4()),))
    assert cur.fetchall() == []


def test_signed_in_users_can_call_spot_details(spots):
    cur = spots["cur"]
    act_as(cur, "authenticated", str(uuid.uuid4()))
    cur.execute(SPOT_DETAILS, (spots["with_address"],))
    assert cur.fetchone()[0] == "Oranienstraße"


def test_unknown_address_source_is_rejected(spots):
    cur = spots["cur"]
    act_as(cur, "admin")
    expect_error(
        cur,
        "UPDATE parking_spots SET address_source = 'guessed' WHERE id = %s",
        (spots["without_address"],),
        "check constraint",
    )


def test_spots_in_bbox_is_unchanged(spots):
    """Addresses are fetched on tap; the map query must not grow."""
    cur = spots["cur"]
    act_as(cur, "anon")
    cur.execute("SELECT * FROM spots_in_bbox(13.39, 52.49, 13.41, 52.51, 5)")
    assert [d.name for d in cur.description] == [
        "id", "spot_type", "access", "operator", "capacity", "lon", "lat", "report_status", "report_at",
    ]


# --- Upsert keeps nearest-rule addresses (SA2) -----------------------------

import json  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_osm  # noqa: E402


def _upsert(cur, city_id, osm_id, **address):
    row = {
        "city_id": city_id, "osm_id": osm_id, "osm_type": "node", "spot_type": "lot", "access": None,
        "operator": None, "capacity": None,
        "geom_json": json.dumps({"type": "Point", "coordinates": [13.4, 52.5]}), "tags": "{}",
        "address_street": None, "address_housenumber": None, "address_postcode": None,
        "address_source": None, "address_distance_m": None, **address,
    }
    cur.execute(import_osm._UPSERT_SQL, row)


def _stored(cur, osm_id):
    cur.execute("SELECT address_street, address_housenumber, address_source FROM parking_spots "
                "WHERE osm_id = %s AND osm_type = 'node'", (osm_id,))
    return cur.fetchone()


@pytest.fixture
def berlin(write_tx):
    act_as(write_tx, "admin")
    write_tx.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    return write_tx, str(write_tx.fetchone()[0])


def test_reimport_without_own_address_keeps_a_nearest_rule_address(berlin):
    cur, city_id = berlin
    _upsert(cur, city_id, -920_000_001)
    cur.execute("UPDATE parking_spots SET address_street = 'Oranienstraße', address_housenumber = '12', "
                "address_source = 'nearest_address', address_distance_m = 20 WHERE osm_id = -920000001")
    _upsert(cur, city_id, -920_000_001)  # re-import: still no own address
    assert _stored(cur, -920_000_001) == ("Oranienstraße", "12", "nearest_address")


def test_reimport_with_own_address_replaces_a_nearest_rule_address(berlin):
    cur, city_id = berlin
    _upsert(cur, city_id, -920_000_002)
    cur.execute("UPDATE parking_spots SET address_street = 'Oranienstraße', address_source = 'nearest_street', "
                "address_distance_m = 30 WHERE osm_id = -920000002")
    _upsert(cur, city_id, -920_000_002, address_street="Adalbertstraße", address_housenumber="3",
            address_source="own_tags", address_distance_m=0.0)
    assert _stored(cur, -920_000_002) == ("Adalbertstraße", "3", "own_tags")


def test_reimport_clears_own_tags_that_were_removed_in_osm(berlin):
    cur, city_id = berlin
    _upsert(cur, city_id, -920_000_003, address_street="Adalbertstraße", address_source="own_tags",
            address_distance_m=0.0)
    _upsert(cur, city_id, -920_000_003)  # tag gone in OSM
    assert _stored(cur, -920_000_003) == (None, None, None)
