"""DB-level tests for supabase/migrations/007_spot_reports.sql (SPEC-spot-reports.md).

Every test writes, so every test goes through the `write_tx` fixture: local
database only, opt-in via FREIPARK_DB_WRITE_TESTS=1, always rolled back.
"""
import uuid
from datetime import timedelta

import psycopg2
import pytest

from tests.conftest import act_as

# Roughly 1 m of latitude, in degrees. Good enough for the 150 m / 300 m checks,
# which are asserted with margins of 50 m either side.
M_LAT = 1 / 111_320

BASE_LON, BASE_LAT = 13.4050, 52.5200
REPORT_SPOT = "SELECT * FROM report_spot(%s, %s, %s, %s)"


def expect_error(cur, sql: str, args: tuple, message: str) -> None:
    """Runs `sql`, asserts it fails with `message`, and keeps the transaction usable."""
    cur.execute("SAVEPOINT expect_error")
    with pytest.raises(psycopg2.Error) as exc:
        cur.execute(sql, args)
    cur.execute("ROLLBACK TO SAVEPOINT expect_error")
    assert message in str(exc.value), f"expected {message!r}, got: {exc.value}"


@pytest.fixture
def world(write_tx):
    """One test user plus one street spot and one lot, both at BASE."""
    cur = write_tx
    act_as(cur, "admin")
    user_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO auth.users (id, email, aud, role) VALUES (%s, %s, 'authenticated', 'authenticated')",
        (user_id, f"spot-report-test-{user_id}@example.invalid"),
    )
    cur.execute("SELECT id FROM cities WHERE slug = 'berlin'")
    city_id = cur.fetchone()[0]

    spots: dict[str, str] = {}
    for i, spot_type in enumerate(("street", "lot")):
        cur.execute(
            """
            INSERT INTO parking_spots (city_id, osm_id, osm_type, source, spot_type, access, location)
            VALUES (%s, %s, 'node', 'test', %s, 'free', ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            RETURNING id
            """,
            (city_id, -900_000_000 - i, spot_type, BASE_LON, BASE_LAT),
        )
        spots[spot_type] = str(cur.fetchone()[0])

    return {"cur": cur, "user_id": user_id, "spots": spots}


def report(world, spot_type: str, status: str, metres_north: float):
    cur = world["cur"]
    act_as(cur, "authenticated", world["user_id"])
    cur.execute(
        REPORT_SPOT,
        (world["spots"][spot_type], status, BASE_LON, BASE_LAT + metres_north * M_LAT),
    )
    return cur.fetchone()


# --- Access control -------------------------------------------------------


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_clients_cannot_read_or_write_the_table_directly(world, role):
    cur = world["cur"]
    act_as(cur, role, world["user_id"] if role == "authenticated" else None)
    expect_error(cur, "SELECT * FROM spot_reports", (), "permission denied")
    expect_error(
        cur,
        "INSERT INTO spot_reports (spot_id, user_id, status, distance_m) VALUES (%s, %s, 'free', 0)",
        (world["spots"]["street"], world["user_id"]),
        "permission denied",
    )


def test_anon_cannot_call_report_spot(world):
    cur = world["cur"]
    act_as(cur, "anon")
    expect_error(
        cur, REPORT_SPOT, (world["spots"]["street"], "free", BASE_LON, BASE_LAT), "permission denied"
    )


def test_report_spot_requires_a_user(world):
    cur = world["cur"]
    act_as(cur, "authenticated")  # role but no `sub` claim → auth.uid() is NULL
    expect_error(
        cur, REPORT_SPOT, (world["spots"]["street"], "free", BASE_LON, BASE_LAT), "not_authenticated"
    )


# --- Happy path -----------------------------------------------------------


def test_report_is_stored_and_expires_after_30_minutes(world):
    cur = world["cur"]
    status, reported_at, expires_at = report(world, "street", "free", metres_north=10)

    assert status == "free"
    assert expires_at - reported_at == timedelta(minutes=30)
    assert [d.name for d in cur.description] == ["status", "reported_at", "expires_at"]

    act_as(cur, "admin")
    cur.execute(
        "SELECT user_id::text, status, distance_m FROM spot_reports WHERE spot_id = %s",
        (world["spots"]["street"],),
    )
    user_id, stored_status, distance_m = cur.fetchone()
    assert user_id == world["user_id"]
    assert stored_status == "free"
    assert distance_m == pytest.approx(10, abs=1)


# --- Validation -----------------------------------------------------------


def test_invalid_status_is_rejected(world):
    cur = world["cur"]
    act_as(cur, "authenticated", world["user_id"])
    expect_error(
        cur, REPORT_SPOT, (world["spots"]["street"], "taken", BASE_LON, BASE_LAT), "invalid_status"
    )


def test_unknown_spot_is_rejected(world):
    cur = world["cur"]
    act_as(cur, "authenticated", world["user_id"])
    expect_error(cur, REPORT_SPOT, (str(uuid.uuid4()), "free", BASE_LON, BASE_LAT), "spot_not_found")


@pytest.mark.parametrize(
    ("spot_type", "metres", "accepted"),
    [
        ("street", 100, True),
        ("street", 200, False),
        ("lot", 200, True),
        ("lot", 350, False),
    ],
)
def test_reporting_radius_depends_on_spot_type(world, spot_type, metres, accepted):
    cur = world["cur"]
    act_as(cur, "authenticated", world["user_id"])
    args = (world["spots"][spot_type], "full", BASE_LON, BASE_LAT + metres * M_LAT)
    if accepted:
        cur.execute(REPORT_SPOT, args)
        assert cur.fetchone()[0] == "full"
    else:
        expect_error(cur, REPORT_SPOT, args, "too_far")


# --- Rate limits ----------------------------------------------------------


def test_same_spot_twice_within_5_minutes_is_rejected(world):
    cur = world["cur"]
    report(world, "street", "free", metres_north=10)
    expect_error(
        cur, REPORT_SPOT, (world["spots"]["street"], "full", BASE_LON, BASE_LAT), "rate_limited_spot"
    )


def test_same_spot_again_after_5_minutes_is_allowed(world):
    cur = world["cur"]
    report(world, "street", "free", metres_north=10)
    act_as(cur, "admin")
    cur.execute("UPDATE spot_reports SET reported_at = now() - interval '6 minutes'")
    assert report(world, "street", "full", metres_north=10)[0] == "full"


def test_21st_report_in_an_hour_is_rejected(world):
    cur = world["cur"]
    act_as(cur, "admin")
    # 20 earlier reports, old enough not to trip the per-spot limit.
    cur.execute(
        """
        INSERT INTO spot_reports (spot_id, user_id, status, distance_m, reported_at)
        SELECT %s, %s, 'free', 5, now() - interval '10 minutes'
          FROM generate_series(1, 20)
        """,
        (world["spots"]["lot"], world["user_id"]),
    )
    act_as(cur, "authenticated", world["user_id"])
    expect_error(
        cur, REPORT_SPOT, (world["spots"]["street"], "free", BASE_LON, BASE_LAT), "rate_limited_hourly"
    )


# --- Lifecycle ------------------------------------------------------------


def test_deleting_the_user_deletes_their_reports(world):
    cur = world["cur"]
    report(world, "street", "free", metres_north=10)
    act_as(cur, "admin")
    cur.execute("DELETE FROM auth.users WHERE id = %s", (world["user_id"],))
    cur.execute("SELECT count(*) FROM spot_reports WHERE user_id = %s", (world["user_id"],))
    assert cur.fetchone()[0] == 0


# --- Read path: spots_in_bbox --------------------------------------------

# A ~200 m box around BASE: contains the two test spots, and whatever real
# OSM spots happen to sit there.
SPOTS_IN_TEST_BBOX = "SELECT * FROM spots_in_bbox(%s, %s, %s, %s, 100000)"
TEST_BBOX = (BASE_LON - 0.0015, BASE_LAT - 0.001, BASE_LON + 0.0015, BASE_LAT + 0.001)


def add_report(cur, world, spot_type: str, status: str, minutes_ago: float) -> None:
    act_as(cur, "admin")
    cur.execute(
        """
        INSERT INTO spot_reports (spot_id, user_id, status, distance_m, reported_at)
        VALUES (%s, %s, %s, 5, now() - make_interval(secs => %s))
        """,
        (world["spots"][spot_type], world["user_id"], status, minutes_ago * 60),
    )


def bbox_row(cur, spot_id: str, role: str = "anon") -> dict:
    act_as(cur, role)
    cur.execute(SPOTS_IN_TEST_BBOX, TEST_BBOX)
    names = [d.name for d in cur.description]
    rows = [dict(zip(names, row)) for row in cur.fetchall()]
    matches = [r for r in rows if str(r["id"]) == spot_id]
    assert len(matches) == 1, f"spot {spot_id} not returned exactly once"
    return matches[0]


def test_spots_in_bbox_keeps_its_old_columns_and_adds_two(world):
    cur = world["cur"]
    act_as(cur, "anon")
    cur.execute(SPOTS_IN_TEST_BBOX, TEST_BBOX)
    assert [d.name for d in cur.description] == [
        "id", "spot_type", "access", "operator", "capacity", "lon", "lat",
        "report_status", "report_at",
    ]


def test_spot_without_reports_has_null_report_fields(world):
    row = bbox_row(world["cur"], world["spots"]["street"])
    assert row["report_status"] is None
    assert row["report_at"] is None


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_active_report_is_visible_to_everyone(world, role):
    cur = world["cur"]
    add_report(cur, world, "street", "full", minutes_ago=4)
    row = bbox_row(cur, world["spots"]["street"], role)
    assert row["report_status"] == "full"
    assert row["report_at"] is not None


def test_report_older_than_30_minutes_is_not_shown(world):
    cur = world["cur"]
    add_report(cur, world, "street", "free", minutes_ago=31)
    row = bbox_row(cur, world["spots"]["street"])
    assert row["report_status"] is None
    assert row["report_at"] is None


def test_latest_report_wins(world):
    cur = world["cur"]
    add_report(cur, world, "lot", "free", minutes_ago=10)
    add_report(cur, world, "lot", "full", minutes_ago=2)
    assert bbox_row(cur, world["spots"]["lot"])["report_status"] == "full"


def test_report_lookup_uses_the_spot_latest_index(world):
    """The lateral lookup must hit idx_spot_reports_spot_latest, not scan the
    table. EXPLAIN can't see inside a SECURITY DEFINER function, so this
    explains the same query the function runs."""
    cur = world["cur"]
    act_as(cur, "admin")
    # Enough rows that a sequential scan would be the wrong choice.
    cur.execute(
        """
        INSERT INTO spot_reports (spot_id, user_id, status, distance_m, reported_at)
        SELECT p.id, %s, 'free', 5, now() - interval '1 minute'
          FROM parking_spots p
         WHERE p.location && ST_MakeEnvelope(13.28, 52.47, 13.53, 52.57, 4326)
         LIMIT 1000
        """,
        (world["user_id"],),
    )
    cur.execute("ANALYZE spot_reports")
    cur.execute(
        """
        EXPLAIN
        SELECT ps.id, r.status
          FROM (SELECT p.id FROM parking_spots p
                 WHERE p.location && ST_MakeEnvelope(13.28, 52.47, 13.53, 52.57, 4326)
                 LIMIT 2000) ps
          LEFT JOIN LATERAL (
            SELECT sr.status FROM spot_reports sr
             WHERE sr.spot_id = ps.id AND sr.reported_at > now() - interval '30 minutes'
             ORDER BY sr.reported_at DESC LIMIT 1
          ) r ON true
        """
    )
    plan = "\n".join(row[0] for row in cur.fetchall())
    assert "idx_spot_reports_spot_latest" in plan, plan
