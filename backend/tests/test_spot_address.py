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
