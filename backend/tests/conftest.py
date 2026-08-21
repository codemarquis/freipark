import os

import psycopg2
import pytest
from dotenv import load_dotenv

load_dotenv()


@pytest.fixture(scope="session")
def db_conn():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = False
    yield conn
    conn.close()
