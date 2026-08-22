#!/usr/bin/env python3
"""Import parking spots for every city in the cities table."""

import os
import subprocess
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

_HERE = Path(__file__).parent
load_dotenv(_HERE.parent / ".env")


def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    with psycopg2.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT slug, name FROM cities ORDER BY name")
        cities = cur.fetchall()

    total = len(cities)
    print(f"[import-all] {total} cities to import")

    failed = []
    for i, (slug, name) in enumerate(cities, 1):
        print(f"\n[{i}/{total}] === {name} ({slug}) ===")
        result = subprocess.run(
            [sys.executable, str(_HERE / "import_osm.py"), "--city", slug],
        )
        if result.returncode != 0:
            print(f"  FAILED: {slug}")
            failed.append(slug)

    print()
    if not failed:
        print(f"[import-all] all {total} cities imported successfully")
    else:
        print(f"[import-all] completed with {len(failed)} failure(s): {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
