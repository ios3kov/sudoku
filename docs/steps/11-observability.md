# Step 11 — Observability

## Goal

Make production failures diagnosable without logging private chat content or high-cardinality user/message identifiers.

## Implemented

- OpenTelemetry SDK with OTLP/HTTP trace and metric exporters.
- FastAPI, SQLAlchemy, Redis and Celery instrumentation.
- Celery telemetry initializes from `worker_process_init`, after worker fork.
- JSON structured logging via structlog.
- Correlated `trace_id` / `span_id` fields are added to logs when a span is active.
- HTTP access logging emits only request ID, method, templated route, status and duration; request/query/message bodies are never logged.
- Health/readiness polling is excluded from traces and normalized request metrics/logs to reduce noise and telemetry cost.
- Business metrics added for durable message creation, outbox publication, push delivery/failure, asset verification/rejection/cleanup and active authenticated WebSockets.
- Metric attributes are deliberately bounded; no user, conversation, message or asset IDs are used as labels.
- Defensive sensitive-key redaction added for structured log fields.
- OTLP export is optional. With no `OTEL_EXPORTER_OTLP_ENDPOINT`, telemetry remains local/no-export and does not repeatedly call a missing collector.

## Configuration

- `LOG_LEVEL=INFO`
- `OTEL_SERVICE_NAME=sudoku-api`
- `OTEL_EXPORTER_OTLP_ENDPOINT=https://collector.example.com`

The configured value is a base OTLP/HTTP endpoint; the app sends traces to `/v1/traces` and metrics to `/v1/metrics`.

## Verification

- Python bytecode compilation passes after the changes.
- OpenTelemetry/structlog runtime import verification still requires installing the newly declared packages in this execution environment.
- Real export to an OTLP collector is not claimed until the full service stack is executed.

## Review findings fixed during this step

- Removed a duplicate membership lookup in message edit.
- Worker SQLAlchemy instrumentation is global so sync engines created by task modules are covered.
- Health checks are excluded from high-volume telemetry.

## Next step

Install dependencies in a network-enabled environment, run the complete integration suite and Next production build, then fix any runtime/integration defects before deployment.
