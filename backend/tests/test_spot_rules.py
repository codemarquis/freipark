"""DB tests for parking rules (SPEC-parking-rules.md; migration 012).

Every test writes, so every test goes through `write_tx`: local database
only, opt-in via FREIPARK_DB_WRITE_TESTS=1, always rolled back.
"""
import json
from pathlib import Path

import pytest

from tests.conftest import act_as

MIGRATION = Path(__file__).resolve().parents[2] / "supabase/migrations/012_spot_rules.sql"


def run_migration(cur) -> None:
    """012's statements inside the test's own (rolled-back) transaction."""
    body = "\n".join(
        line for line in MIGRATION.read_text().splitlines()
        if line.strip() not in ("BEGIN;", "COMMIT;") and not line.lstrip().startswith("--")
    )
    act_as(cur, "admin")
    cur.execute(body)


@pytest.fixture
def spots(write_tx):
    """Test spots in Berlin, one per kind of OSM parking feature."""
    cur = write_tx
    act_as(cur, "admin")
    cur.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    city_id = cur.fetchone()[0]
    kinds = {
        "street_side": ("lot", {"amenity": "parking", "parking": "street_side", "fee": "yes"}),
        "half_on_kerb": ("lot", {"amenity": "parking", "parking": "half_on_kerb"}),
        "surface": ("lot", {"amenity": "parking", "parking": "surface"}),
        "no_parking_tag": ("lot", {"amenity": "parking"}),
        "garage": ("garage", {"amenity": "parking", "parking": "multi-storey"}),
        "lane_way": ("street", {"parking:lane:both": "parallel"}),
    }
    ids = {}
    for i, (key, (spot_type, tags)) in enumerate(kinds.items()):
        cur.execute(
            """
            INSERT INTO parking_spots (city_id, osm_id, osm_type, source, spot_type, access, location, tags)
            VALUES (%s, %s, 'way', 'test', %s, NULL, ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326), %s::jsonb)
            RETURNING id
            """,
            (city_id, -920_000_000 - i, spot_type, json.dumps(tags)),
        )
        ids[key] = str(cur.fetchone()[0])
    return {"cur": cur, "ids": ids}


def spot_type(cur, spot_id: str) -> str:
    cur.execute("SELECT spot_type FROM parking_spots WHERE id = %s", (spot_id,))
    return cur.fetchone()[0]


def test_street_parking_areas_become_street(spots):
    cur, ids = spots["cur"], spots["ids"]
    run_migration(cur)
    assert spot_type(cur, ids["street_side"]) == "street"
    assert spot_type(cur, ids["half_on_kerb"]) == "street"


@pytest.mark.parametrize("key, expected", [
    ("surface", "lot"), ("no_parking_tag", "lot"), ("garage", "garage"), ("lane_way", "street"),
])
def test_other_spots_are_untouched(spots, key, expected):
    cur, ids = spots["cur"], spots["ids"]
    run_migration(cur)
    assert spot_type(cur, ids[key]) == expected


ROLLBACK = Path(__file__).resolve().parents[2] / "supabase/self-host/rollback_012_spot_rules.sql"
SPOT_DETAILS = "SELECT * FROM spot_details(%s)"
DETAIL_COLUMNS = ["address_street", "address_housenumber", "address_postcode", "address_source", "city_name"]

RICH_TAGS = {
    "amenity": "parking", "parking": "street_side", "name": "Parkstreifen Nord", "operator": "Bezirksamt",
    "ref": "P7", "capacity": "12", "orientation": "parallel",
    "fee": "yes", "fee:conditional": "no @ (Mo-Sa 00:00-09:00; Su)", "zone": "23",
    "maxstay": "2 hours", "access": "yes", "authentication:disc": "no",
}
ALLOWED = {"fee", "fee:conditional", "zone", "maxstay", "access", "authentication:disc"}


def run_sql_file(cur, path: Path) -> None:
    body = "\n".join(
        line for line in path.read_text().splitlines()
        if line.strip() not in ("BEGIN;", "COMMIT;") and not line.lstrip().startswith("--")
    )
    act_as(cur, "admin")
    cur.execute(body)


def add_spot(cur, tags) -> str:
    act_as(cur, "admin")
    cur.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    city_id = cur.fetchone()[0]
    cur.execute(
        """
        INSERT INTO parking_spots (city_id, osm_id, osm_type, source, spot_type, access, location, tags)
        VALUES (%s, -920100000 - (SELECT count(*) FROM parking_spots WHERE source = 'test'), 'way', 'test',
                'street', NULL, ST_SetSRID(ST_MakePoint(13.4, 52.5), 4326), %s::jsonb)
        RETURNING id
        """,
        (city_id, json.dumps(tags)),
    )
    return str(cur.fetchone()[0])


def details(cur, spot_id: str, role: str = "anon"):
    act_as(cur, role)
    cur.execute(SPOT_DETAILS, (spot_id,))
    return [d.name for d in cur.description], cur.fetchall()


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_spot_details_returns_only_allow_listed_rule_tags(write_tx, role):
    cur = write_tx
    run_migration(cur)
    spot = add_spot(cur, RICH_TAGS)
    columns, rows = details(cur, spot, role)
    assert columns == DETAIL_COLUMNS + ["rule_tags"]
    rule_tags = rows[0][-1]
    assert rule_tags == {k: v for k, v in RICH_TAGS.items() if k in ALLOWED}
    for private in ("name", "operator", "ref", "capacity", "parking", "amenity"):
        assert private not in rule_tags


def test_rule_tags_are_empty_for_a_spot_without_any(write_tx):
    cur = write_tx
    run_migration(cur)
    spot = add_spot(cur, {"amenity": "parking", "parking": "surface"})
    _, rows = details(cur, spot)
    assert rows[0][-1] == {}


def test_non_text_values_are_left_out(write_tx):
    cur = write_tx
    run_migration(cur)
    spot = add_spot(cur, {"fee": "yes", "maxstay": 120, "zone": None, "access": ["yes"]})
    _, rows = details(cur, spot)
    assert rows[0][-1] == {"fee": "yes"}


def test_rollback_restores_the_010_function_and_can_run_twice(write_tx):
    cur = write_tx
    run_migration(cur)
    spot = add_spot(cur, RICH_TAGS)
    run_sql_file(cur, ROLLBACK)
    run_sql_file(cur, ROLLBACK)
    columns, rows = details(cur, spot)
    assert columns == DETAIL_COLUMNS
    assert len(rows[0]) == 5
    # Part 1 stays: street parking areas remain street.
    act_as(cur, "admin")
    cur.execute("SELECT spot_type FROM parking_spots WHERE id = %s", (spot,))
    assert cur.fetchone()[0] == "street"


def test_migration_is_safe_to_rerun(spots):
    cur, ids = spots["cur"], spots["ids"]
    run_migration(cur)
    run_migration(cur)
    assert spot_type(cur, ids["street_side"]) == "street"
    assert spot_type(cur, ids["surface"]) == "lot"
