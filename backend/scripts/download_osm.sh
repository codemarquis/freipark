#!/usr/bin/env bash
# Download Geofabrik PBF for a city without running the full import.
# Usage: bash download_osm.sh <city-slug> [--force-download]
set -euo pipefail

CITY="${1:?Usage: bash download_osm.sh <city-slug>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/../.venv/bin/activate" ]]; then
  source "$SCRIPT_DIR/../.venv/bin/activate"
fi

exec python3 "$SCRIPT_DIR/import_osm.py" --city "$CITY" --download-only "${@:2}"
