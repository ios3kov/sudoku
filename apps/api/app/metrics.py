from __future__ import annotations

from functools import lru_cache

from opentelemetry import metrics


@lru_cache(maxsize=1)
def _instruments():
    meter = metrics.get_meter("sudoku.messaging", "0.1.0")
    return {
        "http_requests": meter.create_counter(
            "sudoku.http.requests",
            unit="{request}",
            description="HTTP requests handled by the API",
        ),
        "http_duration": meter.create_histogram(
            "sudoku.http.duration",
            unit="ms",
            description="HTTP request duration",
        ),
        "messages_created": meter.create_counter(
            "sudoku.messages.created",
            unit="{message}",
            description="Durably created chat messages",
        ),
        "outbox_published": meter.create_counter(
            "sudoku.outbox.published",
            unit="{event}",
            description="Outbox events published to realtime fan-out",
        ),
        "push_sent": meter.create_counter(
            "sudoku.push.sent",
            unit="{notification}",
            description="Successfully delivered Web Push requests",
        ),
        "push_failed": meter.create_counter(
            "sudoku.push.failed",
            unit="{notification}",
            description="Failed Web Push requests",
        ),
        "assets_verified": meter.create_counter(
            "sudoku.assets.verified",
            unit="{asset}",
            description="Uploaded assets that passed server-side verification",
        ),
        "assets_rejected": meter.create_counter(
            "sudoku.assets.rejected",
            unit="{asset}",
            description="Uploaded assets rejected by integrity/type verification",
        ),
        "assets_cleaned": meter.create_counter(
            "sudoku.assets.cleaned",
            unit="{asset}",
            description="Stale/orphan assets removed",
        ),
        "websocket_connections": meter.create_up_down_counter(
            "sudoku.websocket.connections",
            unit="{connection}",
            description="Currently accepted authenticated WebSocket connections per process",
        ),
    }


def record_http(method: str, route: str, status_code: int, duration_ms: float) -> None:
    attrs = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": status_code,
    }
    instruments = _instruments()
    instruments["http_requests"].add(1, attrs)
    instruments["http_duration"].record(duration_ms, attrs)


def record_message_created(message_type: str) -> None:
    _instruments()["messages_created"].add(1, {"message.type": message_type})


def record_outbox_published(event_type: str, count: int = 1) -> None:
    _instruments()["outbox_published"].add(count, {"event.type": event_type})


def record_push_sent(count: int = 1) -> None:
    _instruments()["push_sent"].add(count)


def record_push_failed(reason: str, count: int = 1) -> None:
    # reason must remain bounded; callers use a fixed enum-like value.
    _instruments()["push_failed"].add(count, {"failure.reason": reason})


def record_asset_verified(mime_family: str) -> None:
    _instruments()["assets_verified"].add(1, {"asset.family": mime_family})


def record_asset_rejected(reason: str) -> None:
    _instruments()["assets_rejected"].add(1, {"failure.reason": reason})


def record_assets_cleaned(count: int) -> None:
    if count:
        _instruments()["assets_cleaned"].add(count)


def websocket_connection_delta(delta: int) -> None:
    _instruments()["websocket_connections"].add(delta)
