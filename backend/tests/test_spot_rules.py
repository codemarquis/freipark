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


def test_migration_is_safe_to_rerun(spots):
    cur, ids = spots["cur"], spots["ids"]
    run_migration(cur)
    run_migration(cur)
    assert spot_type(cur, ids["street_side"]) == "street"
    assert spot_type(cur, ids["surface"]) == "lot"
