from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _mock_pool(rows):
    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=rows)
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=None)
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool


def test_health_db_get_returns_city_counts():
    rows = [{"slug": "berlin", "spot_count": 5}]
    with patch("routers.health.get_pool", AsyncMock(return_value=_mock_pool(rows))):
        resp = client.get("/health/db")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["total_spots"] == 5
    assert body["cities"] == [{"city": "berlin", "spot_count": 5}]


def test_health_db_head_is_allowed_not_405():
    # Regression: uptime monitors (e.g. UptimeRobot) default to HEAD requests
    # to save bandwidth. GET-only routes 405 on HEAD, causing false "down"
    # alerts against a server that's actually healthy.
    rows = [{"slug": "berlin", "spot_count": 5}]
    with patch("routers.health.get_pool", AsyncMock(return_value=_mock_pool(rows))):
        resp = client.head("/health/db")
    assert resp.status_code == 200
    assert resp.content == b""


def test_health_db_returns_503_on_db_error():
    with patch("routers.health.get_pool", AsyncMock(side_effect=RuntimeError("pool down"))):
        resp = client.get("/health/db")
    assert resp.status_code == 503
