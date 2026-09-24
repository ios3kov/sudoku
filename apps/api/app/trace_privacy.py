"""Export diagnostic timings without request payloads or database statements."""
from collections.abc import Sequence

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import Status

_ATTRIBUTES = frozenset({
    "http.method", "http.request.method", "http.route", "http.status_code",
    "http.response.status_code", "db.system", "db.system.name",
    "db.redis.database_index", "network.protocol.version",
})
_RESOURCE_ATTRIBUTES = frozenset({
    "service.name", "service.version", "deployment.environment.name",
    "telemetry.sdk.name", "telemetry.sdk.language", "telemetry.sdk.version",
})


class PrivateSpanExporter(SpanExporter):
    """Allowlist at the export boundary, including exception and span metadata.

    Raw URLs, SQL/Redis statements, headers, exception messages/stacks and custom
    span names may contain private data. Keep timing, trace ancestry, kind,
    status code and known low-cardinality diagnostic attributes only.
    """

    def __init__(self, delegate: SpanExporter):
        self.delegate = delegate

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        safe = []
        for span in spans:
            attributes = {key: value for key, value in (span.attributes or {}).items() if key in _ATTRIBUTES}
            name = "http.request" if any(key.startswith("http.") for key in attributes) else (
                "db.operation" if any(key.startswith("db.") for key in attributes) else "application.operation"
            )
            resource = Resource({key: value for key, value in span.resource.attributes.items()
                                 if key in _RESOURCE_ATTRIBUTES})
            safe.append(ReadableSpan(
                name=name, context=span.context, parent=span.parent, kind=span.kind,
                resource=resource, attributes=attributes,
                status=Status(span.status.status_code), start_time=span.start_time,
                end_time=span.end_time,
            ))
        return self.delegate.export(safe)

    def shutdown(self) -> None:
        self.delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self.delegate.force_flush(timeout_millis)
