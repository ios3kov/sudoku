import unittest

import httpx
from app.trace_privacy import PrivateSpanExporter
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Status, StatusCode


class TracePrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_http_instrumentation_does_not_export_private_query(self):
        sink = InMemorySpanExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(PrivateSpanExporter(sink)))
        app = FastAPI()

        @app.get("/v1/contacts")
        async def contacts():
            return {"ok": True}

        FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                await client.get("/v1/contacts?q=SYNTHETIC_PRIVATE_PHONE")
                await client.get("/missing/SYNTHETIC_PRIVATE_PATH")
            spans = sink.get_finished_spans()
            self.assertTrue(spans)
            serialized = "".join(span.to_json() for span in spans)
            self.assertNotIn("SYNTHETIC_PRIVATE", serialized)
            self.assertTrue(any(span.attributes.get("http.route") == "/v1/contacts" for span in spans))
        finally:
            FastAPIInstrumentor.uninstrument_app(app)
            provider.shutdown()

    def test_custom_payloads_and_exception_details_are_removed_without_mutating_source(self):
        raw, sink = InMemorySpanExporter(), InMemorySpanExporter()
        provider = TracerProvider(resource=Resource({"service.name": "audit", "private": "PRIVATE_RESOURCE"}))
        provider.add_span_processor(SimpleSpanProcessor(raw))
        provider.add_span_processor(SimpleSpanProcessor(PrivateSpanExporter(sink)))
        try:
            with provider.get_tracer("PRIVATE_SCOPE").start_as_current_span("PRIVATE_NAME") as span:
                span.set_attribute("db.system", "redis")
                span.set_attribute("db.statement", "SET PRIVATE_KEY PRIVATE_VALUE")
                span.set_attribute("http.request.header.authorization", "PRIVATE_AUTH")
                span.record_exception(ValueError("PRIVATE_EXCEPTION"))
                span.set_status(Status(StatusCode.ERROR, "PRIVATE_STATUS"))
            original, filtered = raw.get_finished_spans()[0], sink.get_finished_spans()[0]
            self.assertIn("PRIVATE_", original.to_json())
            self.assertNotIn("PRIVATE_", filtered.to_json())
            self.assertEqual(filtered.attributes, {"db.system": "redis"})
            self.assertEqual(filtered.context, original.context)
            self.assertEqual(filtered.start_time, original.start_time)
            self.assertEqual(filtered.end_time, original.end_time)
            self.assertEqual(filtered.status.status_code, StatusCode.ERROR)
        finally:
            provider.shutdown()
