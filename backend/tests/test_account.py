from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from jose import jwt

import auth
from main import app

client = TestClient(app)


def _make_token(sub: str = "user-123", **overrides) -> str:
    claims = {"sub": sub, "aud": "authenticated", **overrides}
    return jwt.encode(claims, auth.JWT_SECRET, algorithm="HS256")


def test_get_current_user_id_accepts_a_valid_token():
    token = _make_token(sub="abc-123")
    app.dependency_overrides.clear()

    async def _call():
        return await auth.get_current_user_id(authorization=f"Bearer {token}")

    import asyncio

    assert asyncio.run(_call()) == "abc-123"


def test_get_current_user_id_rejects_a_token_signed_with_the_wrong_secret():
    bad_token = jwt.encode({"sub": "x", "aud": "authenticated"}, "wrong-secret", algorithm="HS256")

    async def _call():
        return await auth.get_current_user_id(authorization=f"Bearer {bad_token}")

    import asyncio

    with pytest.raises(Exception):
        asyncio.run(_call())


def test_delete_account_calls_gotrue_admin_api_and_returns_deleted():
    app.dependency_overrides[auth.get_current_user_id] = lambda: "abc-123"
    try:
        with patch("routers.account.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.delete = AsyncMock(return_value=AsyncMock(status_code=200))
            mock_client_cls.return_value.__aenter__.return_value = mock_client

            resp = client.delete("/account", headers={"Authorization": "Bearer whatever"})

        assert resp.status_code == 200
        assert resp.json() == {"status": "deleted"}
        called_url = mock_client.delete.call_args.args[0]
        assert called_url.endswith("/auth/v1/admin/users/abc-123")
    finally:
        app.dependency_overrides.clear()


def test_delete_account_returns_502_when_gotrue_admin_api_fails():
    app.dependency_overrides[auth.get_current_user_id] = lambda: "abc-123"
    try:
        with patch("routers.account.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.delete = AsyncMock(return_value=AsyncMock(status_code=500))
            mock_client_cls.return_value.__aenter__.return_value = mock_client

            resp = client.delete("/account", headers={"Authorization": "Bearer whatever"})

        assert resp.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_delete_account_requires_authorization_header():
    app.dependency_overrides.clear()
    resp = client.delete("/account")
    assert resp.status_code == 422  # missing required Authorization header
