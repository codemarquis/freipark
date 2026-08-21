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


# Adding a second city = append one Region(...) + set OSRM_<CITY>_URL in the environment.
# The /route endpoint never references city names directly — it dispatches by coordinate.
REGIONS: list[Region] = [
    Region(
        name="berlin",
        osrm_url=os.environ.get("OSRM_BERLIN_URL", "http://osrm-berlin:5000"),
        bbox=RegionBbox(min_lon=13.088, min_lat=52.338, max_lon=13.761, max_lat=52.677),
    ),
]


def region_for(lon: float, lat: float) -> Region | None:
    for region in REGIONS:
        if region.bbox.contains(lon, lat):
            return region
    return None
