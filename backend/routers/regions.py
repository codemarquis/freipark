from __future__ import annotations
import os
from pydantic import BaseModel


class RegionBbox(BaseModel):
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def contains(self, lon: float, lat: float) -> bool:
        return self.min_lon <= lon <= self.max_lon and self.min_lat <= lat <= self.max_lat


class Region(BaseModel):
    name: str
    osrm_url: str
    bbox: RegionBbox


# Adding a new country/region = append one Region(...) + set OSRM_<NAME>_URL in the environment.
# The /route endpoint never references region names directly — it dispatches by coordinate.
REGIONS: list[Region] = [
    Region(
        name="germany",
        osrm_url=os.environ.get("OSRM_GERMANY_URL", "http://osrm-germany:5000"),
        bbox=RegionBbox(min_lon=5.87, min_lat=47.27, max_lon=15.04, max_lat=55.06),
    ),
]


def region_for(lon: float, lat: float) -> Region | None:
    for region in REGIONS:
        if region.bbox.contains(lon, lat):
            return region
    return None
