from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from db.connection import close_pool, open_pool

load_dotenv()

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="FreiPark API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

from routers import health, route

app.include_router(health.router)
app.include_router(route.router)
