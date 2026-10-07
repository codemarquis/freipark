import json
import os
from urllib.parse import urlparse

import psycopg2
import pytest
from dotenv import load_dotenv

load_dotenv()

LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1"}


@pytest.fixture(scope="session")
def db_conn():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    yield conn
    conn.close()


@pytest.fixture
def write_tx(request):
    """A cursor for tests that write. Everything it does is rolled back.

    Two extra guards on top of the rollback, because backend/.env's
    DATABASE_URL has pointed at production since the self-hosted cutover:
    the host must be local, and FREIPARK_DB_WRITE_TESTS=1 must be set.
    A localhost SSH tunnel to production can't be told apart from a local
    container by hostname, so the opt-in flag is what makes running these
    a deliberate choice; the rollback is what makes a mistake harmless.
    """
    host = urlparse(os.environ["DATABASE_URL"]).hostname
    if host not in LOCAL_DB_HOSTS:
        pytest.skip(f"write tests only run against a local database, not {host}")
    if os.environ.get("FREIPARK_DB_WRITE_TESTS") != "1":
        pytest.skip("set FREIPARK_DB_WRITE_TESTS=1 to run write tests (local stack only)")

    # Only connect once both guards have passed — requesting db_conn as a
    # parameter would open the connection before the checks above run.
    db_conn = request.getfixturevalue("db_conn")
    db_conn.rollback()
    cur = db_conn.cursor()
    try:
        yield cur
    finally:
        cur.close()
        db_conn.rollback()


def act_as(cur, role: str, sub: str | None = None) -> None:
    """Switch the current transaction to a PostgREST-style role, the same
    way PostgREST does per request: SET ROLE plus request.jwt.claims, which
    is what auth.uid() reads. `act_as(cur, "admin")` switches back."""
    if role == "admin":
        cur.execute("RESET ROLE")
        cur.execute("SELECT set_config('request.jwt.claims', '', true)")
        return
    claims: dict[str, str] = {"role": role}
    if sub is not None:
        claims["sub"] = sub
    cur.execute(f"SET LOCAL ROLE {role}")
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
