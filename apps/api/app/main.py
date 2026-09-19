import anyio
from fastapi import Depends, FastAPI, Response, status
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import engine, get_db
from .middleware import RequestObservabilityMiddleware, SameOriginMutationMiddleware
from .observability import configure_structured_logging, configure_telemetry
from .routes.auth import router as auth_router
from .routes.messaging import router as messaging_router
from .routes.assets import router as assets_router
from .routes.push import router as push_router
from .realtime import router as realtime_router
from .e2ee import router as e2ee_router
from .schemas import HealthResponse, ReadinessResponse
from .storage import s3_client

settings = get_settings()
configure_structured_logging(settings.otel_service_name)
configure_telemetry(settings.otel_service_name, engine.sync_engine)
readiness_redis = Redis.from_url(settings.redis_url, decode_responses=False)

app = FastAPI(title="Sudoku API", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(RequestObservabilityMiddleware)
app.add_middleware(SameOriginMutationMiddleware)
app.include_router(auth_router)
app.include_router(messaging_router)
app.include_router(assets_router)
app.include_router(push_router)
app.include_router(realtime_router)
app.include_router(e2ee_router)
FastAPIInstrumentor.instrument_app(app, excluded_urls="/v1/health")


@app.get("/v1/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/v1/health/ready", response_model=ReadinessResponse, tags=["system"])
async def readiness(response: Response, db: AsyncSession = Depends(get_db)) -> ReadinessResponse:
    postgres_ok = redis_ok = storage_ok = False
    try:
        await db.execute(text("SELECT 1"))
        postgres_ok = True
    except Exception:
        pass
    try:
        redis_ok = bool(await readiness_redis.ping())
    except Exception:
        pass

    def check_storage() -> bool:
        s3_client().head_bucket(Bucket=settings.s3_bucket)
        return True

    try:
        storage_ok = await anyio.to_thread.run_sync(check_storage)
    except Exception:
        pass

    ready = postgres_ok and redis_ok and storage_ok
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status="ready" if ready else "not_ready",
        postgres=postgres_ok,
        redis=redis_ok,
        object_storage=storage_ok,
    )
