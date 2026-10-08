"""DB tests for road events (SPEC-road-closures.md; migration 011).

Every test writes, so every test goes through `write_tx`: local database
only, opt-in via FREIPARK_DB_WRITE_TESTS=1, always rolled back.
"""
import json

import pytest

from tests.conftest import act_as
from tests.test_spot_reports import expect_error

IN_BBOX = "SELECT * FROM road_events_in_bbox(%s, %s, %s, %s, %s)"
COLUMNS = ["id", "kind", "road", "title", "subtitle", "description", "starts_at", "ends_at", "geometry"]


def add_event(cur, source_id, kind="roadworks", lon=13.30, lat=52.53, source="autobahn", **extra):
    cur.execute(
        """
        INSERT INTO road_events (source, source_id, kind, road, title, subtitle, description, starts_at, ends_at, geom)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                ST_SetSRID(ST_MakeLine(ST_MakePoint(%s, %s), ST_MakePoint(%s, %s)), 4326))
        """,
        (
            source, source_id, kind, extra.get("road", "A100"), extra.get("title", "A100 | Test"),
            extra.get("subtitle"), extra.get("description", []), extra.get("starts_at"), extra.get("ends_at"),
            lon, lat, lon + 0.01, lat - 0.003,
        ),
    )


@pytest.fixture
def events(write_tx):
    cur = write_tx
    act_as(cur, "admin")
    add_event(cur, "test-berlin-1", kind="closure", subtitle="FreiPark-Test Nord -> Süd",
              description=["Beginn: 08.10.26", "Ende: 21.10.26 um 16:00 Uhr"],
              starts_at="2026-10-08T12:00:00+02:00", ends_at="2026-10-21T16:00:00+02:00")
    add_event(cur, "test-munich-1", lon=11.58, lat=48.14)
    return cur


def test_anon_gets_events_inside_the_box_only(events):
    cur = events
    act_as(cur, "anon")
    cur.execute(IN_BBOX, (13.25, 52.50, 13.35, 52.56, 100))
    assert [d.name for d in cur.description] == COLUMNS
    rows = [dict(zip(COLUMNS, r)) for r in cur.fetchall()]
    titles = {(r["kind"], r["subtitle"]) for r in rows}
    assert ("closure", "FreiPark-Test Nord -> Süd") in titles
    assert all(abs(json.loads(r["geometry"])["coordinates"][0][0] - 11.58) > 0.5 for r in rows)


def test_returns_geojson_and_the_details(events):
    cur = events
    act_as(cur, "anon")
    cur.execute(IN_BBOX, (13.25, 52.50, 13.35, 52.56, 100))
    row = next(dict(zip(COLUMNS, r)) for r in cur.fetchall() if r[4] == "FreiPark-Test Nord -> Süd")
    geometry = json.loads(row["geometry"])
    assert geometry["type"] == "LineString"
    assert geometry["coordinates"][0] == [13.3, 52.53]
    assert row["description"] == ["Beginn: 08.10.26", "Ende: 21.10.26 um 16:00 Uhr"]
    assert row["ends_at"] is not None


def test_signed_in_users_can_call_it_too(events):
    cur = events
    act_as(cur, "authenticated", "00000000-0000-4000-8000-000000000001")
    cur.execute(IN_BBOX, (11.5, 48.1, 11.7, 48.2, 100))
    assert len(cur.fetchall()) >= 1


def test_limit_is_respected(events):
    cur = events
    act_as(cur, "admin")
    for i in range(5):
        add_event(cur, f"test-many-{i}", lon=13.30 + i * 0.001)
    act_as(cur, "anon")
    cur.execute(IN_BBOX, (13.25, 52.50, 13.35, 52.56, 3))
    assert len(cur.fetchall()) == 3


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_clients_cannot_read_or_write_the_table(events, role):
    cur = events
    act_as(cur, role, "00000000-0000-4000-8000-000000000001" if role == "authenticated" else None)
    expect_error(cur, "SELECT * FROM road_events", (), "permission denied")
    expect_error(cur, "DELETE FROM road_events", (), "permission denied")


@pytest.mark.parametrize(
    ("column", "value"),
    [("source", "tomtom"), ("kind", "traffic_jam")],
)
def test_unknown_source_or_kind_is_rejected(events, column, value):
    cur = events
    act_as(cur, "admin")
    expect_error(cur, f"UPDATE road_events SET {column} = %s WHERE source_id = 'test-munich-1'",
                 (value,), "check constraint")


def test_the_same_source_event_cannot_be_stored_twice(events):
    cur = events
    act_as(cur, "admin")
    cur.execute("SAVEPOINT dup")
    with pytest.raises(Exception) as exc:
        add_event(cur, "test-munich-1")
    cur.execute("ROLLBACK TO SAVEPOINT dup")
    assert "duplicate key" in str(exc.value)
