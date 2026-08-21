from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

from db.connection import close_pool, open_pool

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="FreiPark API", lifespan=lifespan)

from routers import health

app.include_router(health.router)
