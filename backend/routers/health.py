from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.connection import get_pool

router = APIRouter()


class CityHealth(BaseModel):
    city: str
    spot_count: int


class HealthResponse(BaseModel):
    status: str
    total_spots: int
    cities: list[CityHealth]


@router.get("/health/db", response_model=HealthResponse)
async def health_db() -> HealthResponse:
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT c.slug, count(ps.id)::int AS spot_count
                FROM cities c
                LEFT JOIN parking_spots ps ON ps.city_id = c.id
                GROUP BY c.slug
                ORDER BY c.slug
            """)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={"status": "error", "detail": str(exc)},
        )

    cities = [CityHealth(city=r["slug"], spot_count=r["spot_count"]) for r in rows]
    return HealthResponse(
        status="ok",
        total_spots=sum(c.spot_count for c in cities),
        cities=cities,
    )
