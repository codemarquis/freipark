"""DB tests for spot addresses (SPEC-spot-address.md; migration 010).

Every test writes, so every test goes through `write_tx`: local database
only, opt-in via FREIPARK_DB_WRITE_TESTS=1, always rolled back.
"""
import uuid

import pytest

from tests.conftest import act_as
from tests.test_spot_reports import expect_error

# 012 added rule_tags (SPEC-parking-rules.md); these spots have no rule tags.
ADDRESS_COLUMNS = ["address_street", "address_housenumber", "address_postcode", "address_source", "city_name",
                   "rule_tags"]
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
    assert cur.fetchall() == [("Oranienstraße", "12", "10997", "nearest_address", "Berlin", {})]


def test_spot_details_returns_nulls_for_a_spot_without_an_address(spots):
    cur = spots["cur"]
    act_as(cur, "anon")
    cur.execute(SPOT_DETAILS, (spots["without_address"],))
    assert cur.fetchall() == [(None, None, None, None, "Berlin", {})]


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


# --- Rules 3-4: nearest address point / named street (SA3) ----------------

M_LAT = 1 / 111_320  # ~1 m of latitude, in degrees
LON0, LAT0 = 13.40, 52.50


@pytest.fixture
def area(write_tx):
    """Temp address tables as the importer creates them, a throwaway city (so
    the step doesn't recompute every real Berlin spot), and helpers."""
    cur = write_tx
    act_as(cur, "admin")
    cur.execute("INSERT INTO cities (slug, name, country_code, geofabrik_url) "
                "VALUES ('test-address-city', 'Teststadt', 'DE', 'https://example.invalid/test.osm.pbf') RETURNING id")
    city_id = str(cur.fetchone()[0])
    cur.execute(import_osm._ADDRESS_TEMP_TABLES_SQL)
    cur.execute(import_osm._ADDRESS_PREPARE_SQL)  # empty final tables + indexes

    def point(street, number, metres_north, postcode=None):
        cur.execute("INSERT INTO addr_points (street, housenumber, postcode, geom) "
                    "VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                    (street, number, postcode, LON0, LAT0 + metres_north * M_LAT))

    def street(name, metres_north):
        lat = LAT0 + metres_north * M_LAT
        cur.execute("INSERT INTO addr_streets (name, geom) "
                    "VALUES (%s, ST_SetSRID(ST_MakeLine(ST_MakePoint(%s, %s), ST_MakePoint(%s, %s)), 4326))",
                    (name, LON0 - 0.002, lat, LON0 + 0.002, lat))

    def spot(osm_id, **address):
        _upsert(cur, city_id, osm_id, **address)

    def assign():
        cur.execute(import_osm._ASSIGN_ADDRESSES_SQL, {"city_id": city_id})

    def stored(osm_id):
        cur.execute("SELECT address_street, address_housenumber, address_postcode, address_source, "
                    "round(address_distance_m) FROM parking_spots WHERE osm_id = %s AND osm_type = 'node'", (osm_id,))
        return cur.fetchone()

    return {"cur": cur, "point": point, "street": street, "spot": spot, "assign": assign, "stored": stored}


def test_nearest_address_point_within_60m_wins(area):
    area["spot"](-930_000_001)
    area["point"]("Fernstraße", "1", 45)
    area["point"]("Oranienstraße", "12", 20, postcode="10997")
    area["street"]("Nahweg", 5)  # a closer street does not beat an address point
    area["assign"]()
    assert area["stored"](-930_000_001) == ("Oranienstraße", "12", "10997", "nearest_address", 20)


def test_falls_back_to_nearest_named_street(area):
    area["spot"](-930_000_002)
    area["point"]("Fernstraße", "1", 61)
    area["street"]("Oranienstraße", 30)
    area["assign"]()
    assert area["stored"](-930_000_002) == ("Oranienstraße", None, None, "nearest_street", 30)


def test_nothing_within_60m_leaves_the_address_empty(area):
    area["spot"](-930_000_003)
    area["point"]("Fernstraße", "1", 61)
    area["street"]("Fernweg", 75)
    area["assign"]()
    assert area["stored"](-930_000_003) == (None, None, None, None, None)


def test_no_address_data_at_all_is_handled(area):
    area["spot"](-930_000_004)
    area["assign"]()
    assert area["stored"](-930_000_004) == (None, None, None, None, None)


def test_own_tags_and_street_names_are_never_overwritten(area):
    area["spot"](-930_000_005, address_street="Adalbertstraße", address_housenumber="3",
                  address_source="own_tags", address_distance_m=0.0)
    area["spot"](-930_000_006, address_street="Ackerstraße", address_source="street_name", address_distance_m=0.0)
    area["point"]("Oranienstraße", "12", 5)
    area["assign"]()
    assert area["stored"](-930_000_005)[3] == "own_tags"
    assert area["stored"](-930_000_006)[:1] + area["stored"](-930_000_006)[3:4] == ("Ackerstraße", "street_name")


def test_a_stale_nearest_address_is_replaced_or_cleared(area):
    area["spot"](-930_000_007)
    area["cur"].execute("UPDATE parking_spots SET address_street = 'Altstraße', address_source = 'nearest_street', "
                        "address_distance_m = 10 WHERE osm_id = -930000007")
    area["assign"]()  # Altstraße no longer in OSM, nothing else nearby
    assert area["stored"](-930_000_007) == (None, None, None, None, None)


def test_running_the_step_twice_gives_the_same_result(area):
    area["spot"](-930_000_008)
    area["point"]("Oranienstraße", "12", 20)
    area["assign"]()
    first = area["stored"](-930_000_008)
    area["assign"]()
    assert area["stored"](-930_000_008) == first


def test_other_cities_are_untouched(area):
    cur = area["cur"]
    cur.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    berlin = str(cur.fetchone()[0])
    _upsert(cur, berlin, -930_000_009)
    area["point"]("Oranienstraße", "12", 0)
    area["assign"]()
    assert area["stored"](-930_000_009) == (None, None, None, None, None)


def test_a_rerun_with_no_changes_rewrites_no_rows(area):
    """Only changed addresses are written: re-imports must not rewrite every
    spot (each row carries its full OSM tags and geometry)."""
    cur = area["cur"]
    area["spot"](-930_000_010)
    area["point"]("Oranienstraße", "12", 20)
    area["assign"]()
    cur.execute("SAVEPOINT before_rerun")  # new subtransaction id for writes after this point
    cur.execute("SELECT xmin::text FROM parking_spots WHERE osm_id = -930000010")
    before = cur.fetchone()[0]
    area["assign"]()
    cur.execute("SELECT xmin::text FROM parking_spots WHERE osm_id = -930000010")
    assert cur.fetchone()[0] == before


def test_address_lookups_use_the_spatial_index(area):
    """Regression: the temp-table indexes must be usable in the same
    transaction, or every lookup becomes a full scan (hours per city)."""
    cur = area["cur"]
    for i in range(300):
        area["point"](f"Straße {i}", str(i), i)
    cur.execute("ANALYZE addr_points")
    cur.execute("SELECT bool_or(indcheckxmin) FROM pg_index WHERE indrelid IN ('addr_points'::regclass, 'addr_streets'::regclass)")
    assert cur.fetchone()[0] is False
    cur.execute("SET LOCAL enable_seqscan = off")  # only to ask: is an index path available at all?
    cur.execute("EXPLAIN SELECT 1 FROM addr_points ap WHERE ap.geom && ST_Expand(ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326), 0.0012) "
                "ORDER BY ap.geom <-> ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326) LIMIT 1")
    assert "addr_points_geom_idx" in "\n".join(r[0] for r in cur.fetchall())
