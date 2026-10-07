"""Seeded-city coverage (SPEC-infra.md § Seeded Cities → Coverage rule).

Read-only: safe against any database, no write_tx needed.
"""

# Germany's extent, generously rounded — every city bbox must sit inside it
# (Frankfurt (Oder)'s box reaches just past the Polish border at 14.6°E).
GERMANY = (5.8, 47.2, 15.1, 55.1)

# Spot checks from migration 008: the two requested towns plus 100k+ cities
# from different states.
REQUIRED = {"cottbus", "frankfurt-oder", "aachen", "bochum", "bielefeld", "heidelberg",
            "regensburg", "kassel", "jena", "kaiserslautern", "osnabruck"}


def _cities(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT slug, geofabrik_url,
                   ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox)
            FROM cities
        """)
        return cur.fetchall()


def test_all_80_cities_are_seeded(db_conn):
    slugs = {row[0] for row in _cities(db_conn)}
    assert len(slugs) == 80, f"expected 80 seeded cities, found {len(slugs)}"
    missing = REQUIRED - slugs
    assert not missing, f"missing cities: {sorted(missing)}"


def test_frankfurt_oder_is_distinct_from_frankfurt_am_main(db_conn):
    by_slug = {row[0]: row for row in _cities(db_conn)}
    assert "hessen" in by_slug["frankfurt"][1]
    assert "brandenburg" in by_slug["frankfurt-oder"][1]


def test_every_state_extract_city_has_a_sane_bbox(db_conn):
    city_states = {"berlin", "hamburg", "bremen"}
    for slug, url, xmin, ymin, xmax, ymax in _cities(db_conn):
        if slug in city_states:
            assert xmin is None, f"{slug}: city-state imports its whole extract, no bbox expected"
            continue
        assert xmin is not None, f"{slug}: state-extract city needs a bbox"
        assert xmin < xmax and ymin < ymax, f"{slug}: inverted bbox"
        assert GERMANY[0] <= xmin and xmax <= GERMANY[2], f"{slug}: bbox outside Germany (lon)"
        assert GERMANY[1] <= ymin and ymax <= GERMANY[3], f"{slug}: bbox outside Germany (lat)"
        # A city, not a region: no bbox wider than ~0.5° (~35 km) in either direction.
        assert xmax - xmin < 0.5 and ymax - ymin < 0.5, f"{slug}: bbox too large"
        assert url.startswith("https://download.geofabrik.de/europe/germany/"), f"{slug}: unexpected extract"
