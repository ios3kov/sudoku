import json
import unittest
from unittest.mock import patch

import httpx
from app.middleware import RequestObservabilityMiddleware
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from structlog.testing import capture_logs


class RequestLogPrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, path, *, fail=False):
        async def endpoint(request):
            if fail:
                raise RuntimeError("synthetic-private-exception")
            await request.body()
            return JSONResponse({"ok": True})

        app = Starlette(routes=[
            Route("/v1/invites/{secret}", endpoint, methods=["POST"]),
            Route("/v1/health", endpoint, methods=["POST"]),
        ])
        app.add_middleware(RequestObservabilityMiddleware)
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        with capture_logs() as logs, patch("app.middleware.record_http") as metric:
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    path + "?token=synthetic-query-secret",
                    headers={"Authorization": "Bearer synthetic-header-secret",
                             "Cookie": "session=synthetic-cookie-secret"},
                    json={"text": "synthetic-message-secret"},
                )
        return response, [entry for entry in logs if entry.get("event") == "http.request"], metric

    def assert_private(self, logs, metric):
        serialized = json.dumps(logs) + repr(metric.call_args_list)
        for secret in ("synthetic-path-secret", "synthetic-query-secret", "synthetic-header-secret",
                       "synthetic-cookie-secret", "synthetic-message-secret", "synthetic-private-exception"):
            self.assertNotIn(secret, serialized)

    async def test_matched_route_logs_template_without_request_secrets(self):
        response, logs, metric = await self.request("/v1/invites/synthetic-path-secret")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["route"], "/v1/invites/{secret}")
        self.assertEqual(logs[0]["request_id"], response.headers["X-Request-ID"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(metric.call_args.args[1], "/v1/invites/{secret}")
        self.assert_private(logs, metric)

    async def test_unknown_route_does_not_log_raw_path(self):
        response, logs, metric = await self.request("/v1/missing/synthetic-path-secret")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(logs[0]["route"], "unmatched")
        self.assert_private(logs, metric)

    async def test_exception_records_status_without_exception_content(self):
        response, logs, metric = await self.request("/v1/invites/synthetic-path-secret", fail=True)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(logs[0]["status_code"], 500)
        self.assert_private(logs, metric)

    async def test_health_requests_do_not_emit_access_events(self):
        response, logs, metric = await self.request("/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(logs, [])
        metric.assert_not_called()
