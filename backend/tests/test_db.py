import pytest


def test_postgis_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT PostGIS_Version()")
        version = cur.fetchone()[0]
    assert version, "PostGIS_Version() returned empty — extension not installed"


def test_berlin_seed_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT slug, name, country_code FROM cities WHERE slug = 'berlin'"
        )
        row = cur.fetchone()
    assert row == ("berlin", "Berlin", "DE")


def test_spatial_index_used(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            EXPLAIN (FORMAT TEXT)
            SELECT id FROM parking_spots
            ORDER BY location <-> ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326)
            LIMIT 10
        """)
        plan = "\n".join(row[0] for row in cur.fetchall())
    assert "Index Scan" in plan, f"Expected KNN index scan, got:\n{plan}"


def test_rls_blocks_anon_insert(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = 'public.parking_spots'::regclass
        """)
        assert cur.fetchone()[0] is True, "RLS not enabled on parking_spots"

        cur.execute("""
            SELECT count(*)
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'parking_spots'
              AND cmd IN ('INSERT', 'ALL')
              AND (roles @> ARRAY['anon'::name] OR roles @> ARRAY['public'::name])
        """)
        count = cur.fetchone()[0]
        assert count == 0, f"Unexpected INSERT/ALL policy grants anon write access ({count} found)"


def test_every_spot_is_car_parking(db_conn):
    """Mirrors import_osm._is_parking_feature (SPEC-infra.md § OSM Import
    Pipeline): nodes the osmium filter only pulled in as references —
    barriers, crossings, garage entrances, charging stations — must not be
    spots. coalesce() matters: NULL IN (...) is NULL, not false."""
    with db_conn.cursor() as cur:
        cur.execute("""
            SELECT count(*) FROM parking_spots
            WHERE NOT (
                coalesce(tags->>'amenity', '') IN ('parking', 'parking_space')
                OR (osm_type = 'way'
                    AND tags ?| array['parking:lane:left', 'parking:lane:right', 'parking:lane:both'])
            )
        """)
        assert cur.fetchone()[0] == 0
