from __future__ import annotations

import logging
import sys
from threading import Lock

import structlog
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.engine import Engine

from .config import get_settings

_config_lock = Lock()
_telemetry_configured = False

_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "set-cookie",
    "password",
    "token",
    "session",
    "secret",
    "auth",
    "p256dh",
    "vapid-private-key",
}


def _redact_sensitive(_: object, __: str, event_dict: dict) -> dict:
    """Defensive log redaction. Request/message bodies are never logged at all."""
    for key in list(event_dict):
        if key.lower().replace("_", "-") in _SENSITIVE_KEYS or any(
            marker in key.lower() for marker in ("password", "secret", "token")
        ):
            event_dict[key] = "[REDACTED]"
    return event_dict


def _add_trace_context(_: object, __: str, event_dict: dict) -> dict:
    context = trace.get_current_span().get_span_context()
    if context.is_valid:
        event_dict["trace_id"] = f"{context.trace_id:032x}"
        event_dict["span_id"] = f"{context.span_id:016x}"
    return event_dict


def configure_structured_logging(service_name: str) -> None:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    def add_service(_: object, __: str, event_dict: dict) -> dict:
        event_dict.setdefault("service", service_name)
        return event_dict

    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        timestamper,
        add_service,
        _add_trace_context,
        _redact_sensitive,
    ]

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
        foreign_pre_chain=shared,
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery"):
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True
    # RequestObservabilityMiddleware produces normalized access logs.
    logging.getLogger("uvicorn.access").disabled = True
    # HTTP client libraries may log full request URLs; invite secrets are carried in one route path.
    # Keep transport internals below INFO so raw secret-bearing URLs cannot enter normal structured logs.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    structlog.configure(
        processors=[
            *shared,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    structlog.get_logger("startup").info("logging.configured", service=service_name)


def _signal_endpoint(base: str, signal: str) -> str:
    return f"{base.rstrip('/')}/v1/{signal}"


def configure_telemetry(service_name: str, sqlalchemy_engine: Engine | None = None) -> None:
    """Configure traces + metrics once per process.

    If no OTLP endpoint is configured, instrumentation remains active with no network exporter.
    This makes local development quiet while keeping the same code path.
    """
    global _telemetry_configured
    with _config_lock:
        if _telemetry_configured:
            return
        settings = get_settings()
        resource = Resource.create(
            {
                "service.name": service_name,
                "service.version": "0.1.0",
                "deployment.environment.name": "production" if settings.secure_cookies else "local",
            }
        )

        tracer_provider = TracerProvider(resource=resource)
        readers = []
        endpoint = settings.otel_exporter_otlp_endpoint
        if endpoint:
            tracer_provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=_signal_endpoint(endpoint, "traces")))
            )
            readers.append(
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(endpoint=_signal_endpoint(endpoint, "metrics")),
                    export_interval_millis=30_000,
                )
            )
        trace.set_tracer_provider(tracer_provider)
        metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=readers))

        if sqlalchemy_engine is not None:
            SQLAlchemyInstrumentor().instrument(engine=sqlalchemy_engine)
        else:
            SQLAlchemyInstrumentor().instrument()
        RedisInstrumentor().instrument()
        _telemetry_configured = True
        structlog.get_logger("startup").info(
            "telemetry.configured",
            service=service_name,
            otlp_export=bool(endpoint),
        )
