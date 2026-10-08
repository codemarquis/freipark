"""Tests for backend/scripts/fetch_autobahn.py (SPEC-road-closures.md).

Parser tests use real items captured from the Autobahn API
(tests/fixtures/autobahn_items.json). The sweep uses a mocked HTTP
transport — no network. DB tests go through `write_tx` (local only,
rolled back).
"""
import copy
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_autobahn as fa  # noqa: E402
from tests.conftest import act_as  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")
FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "autobahn_items.json").read_text(encoding="utf-8"))


def fixture(display_type: str) -> dict:
    return copy.deepcopy(FIXTURES[display_type]["item"])


# --- Parser -----------------------------------------------------------------

@pytest.mark.parametrize(
    ("display_type", "kind"),
    [
        ("ROADWORKS", "roadworks"),
        ("SHORT_TERM_ROADWORKS", "short_term_roadworks"),
        ("CLOSURE", "closure"),
        ("CLOSURE_ENTRY_EXIT", "entry_exit_closure"),
    ],
)
def test_each_type_maps_to_its_kind(display_type, kind):
    event = fa.parse_item(fixture(display_type), "A100")
    assert event is not None
    assert event["kind"] == kind
    assert event["road"] == "A100"
    assert event["source_id"] == fixture(display_type)["identifier"]
    assert event["title"].startswith("A100 |")
    assert json.loads(event["geom_json"])["type"] == "LineString"


def test_unknown_type_is_skipped():
    item = fixture("ROADWORKS")
    item["display_type"] = "WEATHER_WARNING"
    assert fa.parse_item(item, "A100") is None


@pytest.mark.parametrize("missing", ["identifier", "title", "geometry"])
def test_items_missing_essentials_are_skipped(missing):
    item = fixture("ROADWORKS")
    del item[missing]
    assert fa.parse_item(item, "A100") is None


def test_subtitle_is_trimmed_and_description_kept():
    event = fa.parse_item(fixture("ROADWORKS"), "A100")
    assert event["subtitle"] == event["subtitle"].strip()
    assert any("Ende" in line for line in event["description"])


def test_start_timestamp_is_kept():
    event = fa.parse_item(fixture("ROADWORKS"), "A100")
    assert event["starts_at"] == fixture("ROADWORKS")["startTimestamp"]


# --- End dates (German local time) -------------------------------------------

def test_phase_end_with_time():
    assert fa.parse_end(["Beginn: 08.10.26 um 12:00 Uhr", "Ende: 21.10.26 um 16:00 Uhr"]) == datetime(
        2026, 10, 21, 16, 0, tzinfo=BERLIN)


def test_phase_end_wins_over_whole_project_end():
    lines = ["Ende: 21.10.26 um 16:00 Uhr", "(Ende der Gesamtmaßnahme: 30.11.26)"]
    assert fa.parse_end(lines) == datetime(2026, 10, 21, 16, 0, tzinfo=BERLIN)


def test_whole_project_end_is_end_of_that_day():
    assert fa.parse_end(["(Ende der Gesamtmaßnahme: 09.10.26)"]) == datetime(2026, 10, 9, 23, 59, tzinfo=BERLIN)


def test_short_term_windows_end_at_the_latest_window():
    lines = ["Die Baustelle ist zu folgenden Zeiträumen gültig:", "12.10.26 von 10:00 bis 16:00 Uhr",
             "13.10.26 von 09:00 bis 15:30 Uhr"]
    assert fa.parse_end(lines) == datetime(2026, 10, 13, 15, 30, tzinfo=BERLIN)


def test_winter_dates_use_central_european_time():
    assert fa.parse_end(["Ende: 15.01.27 um 08:00 Uhr"]).utcoffset().total_seconds() == 3600


def test_no_recognisable_end_gives_none():
    assert fa.parse_end(["Sperrung wegen Bauarbeiten", ""]) is None


def test_fixture_end_dates_parse():
    assert fa.parse_item(fixture("ROADWORKS"), "A100")["ends_at"] is not None
    assert fa.parse_item(fixture("CLOSURE"), "A100")["ends_at"] is not None
    assert fa.parse_item(fixture("SHORT_TERM_ROADWORKS"), "A100")["ends_at"] is not None


# --- Road list ---------------------------------------------------------------

def test_road_names_are_trimmed_and_deduplicated():
    assert fa.clean_roads(["A1", "A60", "A60 ", " A100", "A1"]) == ["A1", "A100", "A60"]


# --- Sweep (mocked HTTP) -------------------------------------------------------

def make_client(failing_paths=()):
    roadworks = {"roadworks": [fixture("ROADWORKS"), fixture("SHORT_TERM_ROADWORKS")]}
    closures = {"closure": [fixture("CLOSURE"), fixture("CLOSURE_ENTRY_EXIT")]}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if any(path.endswith(p) for p in failing_paths):
            return httpx.Response(503)
        if path.rstrip("/").endswith("/autobahn"):
            return httpx.Response(200, json={"roads": ["A100", "A100 "]})
        if path.endswith("/services/roadworks"):
            return httpx.Response(200, json=roadworks)
        if path.endswith("/services/closure"):
            return httpx.Response(200, json=closures)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler), base_url=fa.BASE_URL)


def test_sweep_collects_every_item_once():
    result = fa.sweep(make_client(), pause=0)
    assert result.requests == 2  # one road (deduplicated) x two services
    assert result.failed == 0
    assert sorted(e["kind"] for e in result.events) == [
        "closure", "entry_exit_closure", "roadworks", "short_term_roadworks"]


def test_sweep_counts_failures_and_keeps_going():
    result = fa.sweep(make_client(failing_paths=("/services/closure",)), pause=0)
    assert result.failed == 1
    assert sorted(e["kind"] for e in result.events) == ["roadworks", "short_term_roadworks"]


# --- Storing (DB) ----------------------------------------------------------------

def events_for(*display_types):
    return [fa.parse_item(fixture(t), "A100") for t in display_types]


def stored(cur):
    cur.execute("SELECT source, source_id, kind, title FROM road_events "
                "WHERE source_id LIKE ANY(%s) OR source = 'osm' ORDER BY kind",
                ([f["item"]["identifier"] for f in FIXTURES.values()] + ["osm-test-%"],))
    return cur.fetchall()


@pytest.fixture
def db(write_tx):
    act_as(write_tx, "admin")
    write_tx.execute("DELETE FROM road_events WHERE source = 'autobahn'")  # rolled back afterwards
    return write_tx


def test_store_inserts_events(db):
    stats = fa.store(db, events_for("ROADWORKS", "CLOSURE"), requests=2, failed=0)
    assert stats["upserted"] == 2
    assert [r[2] for r in stored(db)] == ["closure", "roadworks"]


def test_a_second_sweep_updates_in_place(db):
    fa.store(db, events_for("ROADWORKS"), requests=2, failed=0)
    changed = events_for("ROADWORKS")
    changed[0]["title"] = "A100 | updated title"
    fa.store(db, changed, requests=2, failed=0)
    rows = stored(db)
    assert len(rows) == 1
    assert rows[0][3] == "A100 | updated title"


def test_events_gone_from_a_good_sweep_are_removed(db):
    fa.store(db, events_for("ROADWORKS", "CLOSURE"), requests=200, failed=0)
    stats = fa.store(db, events_for("ROADWORKS"), requests=200, failed=5)  # 97.5% ok
    assert stats["removed"] == 1
    assert [r[2] for r in stored(db)] == ["roadworks"]


def test_nothing_is_removed_after_a_poor_sweep(db):
    fa.store(db, events_for("ROADWORKS", "CLOSURE"), requests=200, failed=0)
    stats = fa.store(db, events_for("ROADWORKS"), requests=200, failed=11)  # 94.5% ok
    assert stats["removed"] == 0
    assert sorted(r[2] for r in stored(db)) == ["closure", "roadworks"]


def test_an_empty_sweep_removes_nothing(db):
    fa.store(db, events_for("ROADWORKS"), requests=200, failed=0)
    stats = fa.store(db, [], requests=0, failed=0)
    assert stats["removed"] == 0
    assert len(stored(db)) == 1


def test_osm_rows_are_never_touched(db):
    db.execute("INSERT INTO road_events (source, source_id, kind, title, geom) VALUES "
               "('osm', 'osm-test-1', 'construction', 'Teststraße', "
               "ST_SetSRID(ST_MakeLine(ST_MakePoint(13.3, 52.5), ST_MakePoint(13.31, 52.5)), 4326))")
    fa.store(db, events_for("ROADWORKS"), requests=200, failed=0)
    assert ("osm", "osm-test-1", "construction", "Teststraße") in stored(db)
