from __future__ import annotations
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from slowapi import Limiter
from slowapi.util import get_remote_address

from .regions import region_for

router = APIRouter(prefix="/route", tags=["routing"])
limiter = Limiter(key_func=get_remote_address)


class RouteParams(BaseModel):
    from_lon: float = Field(..., ge=-180, le=180)
    from_lat: float = Field(..., ge=-90, le=90)
    to_lon:   float = Field(..., ge=-180, le=180)
    to_lat:   float = Field(..., ge=-90, le=90)

    @model_validator(mode="after")
    def destination_in_region(self) -> RouteParams:
        if region_for(self.to_lon, self.to_lat) is None:
            raise ValueError(
                f"Destination ({self.to_lon:.4f}, {self.to_lat:.4f}) "
                "is outside all supported regions"
            )
        return self


class RouteResponse(BaseModel):
    geometry: dict   # GeoJSON LineString — passed through verbatim to the client
    distance_m: float
    duration_s: float
    region: str


@router.get("", response_model=RouteResponse)
@limiter.limit("30/minute")
async def get_route(request: Request, params: RouteParams = Depends()):
    region = region_for(params.to_lon, params.to_lat)  # non-None: validator guarantees it
    coords = f"{params.from_lon},{params.from_lat};{params.to_lon},{params.to_lat}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{region.osrm_url}/route/v1/driving/{coords}",
                params={"overview": "full", "geometries": "geojson"},
            )
        except httpx.TimeoutException:
            raise HTTPException(504, "Routing service timed out")
        except httpx.RequestError:
            raise HTTPException(502, "Routing service unreachable")

    if resp.status_code != 200:
        raise HTTPException(502, "Routing service returned an error")

    data = resp.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(404, "No route found between these coordinates")

    route = data["routes"][0]
    return RouteResponse(
        geometry=route["geometry"],
        distance_m=route["distance"],
        duration_s=route["duration"],
        region=region.name,
    )
