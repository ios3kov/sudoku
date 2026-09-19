import time
import uuid
from urllib.parse import urlparse

import structlog

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import get_settings
from .metrics import record_http


class SameOriginMutationMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        settings = get_settings()
        parsed = urlparse(settings.public_origin)
        self.expected_origin = f"{parsed.scheme}://{parsed.netloc}"

    async def dispatch(self, request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin != self.expected_origin:
                return JSONResponse({"detail": "Invalid origin"}, status_code=403)
        return await call_next(request)


class RequestObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = uuid.uuid4().hex
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            route_obj = request.scope.get("route")
            route = getattr(route_obj, "path", None) or "unmatched"
            if not route.startswith("/v1/health"):
                record_http(request.method, route, status_code, duration_ms)
                structlog.get_logger("http").info(
                    "http.request",
                    request_id=request_id,
                    method=request.method,
                    route=route,
                    status_code=status_code,
                    duration_ms=round(duration_ms, 2),
                )
