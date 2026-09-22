"""Run the actual endpoint with controlled sockets/auth/pubsub; no user data."""
import asyncio
from contextlib import suppress
from types import SimpleNamespace
import uuid

import pytest
from fastapi import WebSocketDisconnect
import app.realtime as realtime


class Socket:
    def __init__(self):
        self.headers = {"origin": realtime.EXPECTED_ORIGIN}
        self.incoming = asyncio.Queue()
        self.sent = []
        self.closed = []
        self.delivered = asyncio.Event()

    async def accept(self):
        pass

    async def receive_text(self):
        value = await self.incoming.get()
        if value is None:
            raise WebSocketDisconnect()
        return value

    async def send_text(self, value):
        self.sent.append(value)
        self.delivered.set()

    async def send_json(self, value):
        self.sent.append(value)
        self.delivered.set()

    async def close(self, code):
        self.closed.append(code)
        self.delivered.set()
        self.incoming.put_nowait(None)


class PubSub:
    def __init__(self):
        self.events = asyncio.Queue()
        self.subscribed = asyncio.Event()
        self.cleaned = False

    async def subscribe(self, _channel):
        self.subscribed.set()

    async def listen(self):
        while True:
            yield await self.events.get()

    async def unsubscribe(self, _channel):
        pass

    async def aclose(self):
        self.cleaned = True


async def prepare(monkeypatch):
    socket, pubsub = Socket(), PubSub()
    validity = {"valid": True}
    metrics = []

    async def authenticate(_socket):
        return SimpleNamespace(id=uuid.uuid4()), uuid.uuid4()

    async def valid(*_args):
        return validity["valid"]

    async def noop(*_args, **_kwargs):
        pass

    monkeypatch.setattr(realtime, "authenticate_websocket", authenticate)
    monkeypatch.setattr(realtime, "session_still_valid", valid)
    monkeypatch.setattr(realtime, "websocket_connection_delta", metrics.append)
    monkeypatch.setattr(realtime, "redis", SimpleNamespace(pubsub=lambda: pubsub, set=noop, delete=noop))
    task = asyncio.create_task(realtime.websocket_endpoint(socket))
    await asyncio.wait_for(pubsub.subscribed.wait(), 1)
    return socket, pubsub, validity, metrics, task


async def stop(task):
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_revoked_silent_socket_cannot_receive_more_events(monkeypatch):
    socket, pubsub, validity, metrics, task = await prepare(monkeypatch)
    try:
        validity["valid"] = False
        pubsub.events.put_nowait({"type": "message", "data": "private test event"})
        await asyncio.wait_for(socket.delivered.wait(), 1)
        assert socket.sent == []
        assert socket.closed == [4401]
    finally:
        await stop(task)
    assert pubsub.cleaned
    assert sum(metrics) == 0


@pytest.mark.asyncio
async def test_valid_socket_still_receives_events(monkeypatch):
    socket, pubsub, _, _, task = await prepare(monkeypatch)
    try:
        pubsub.events.put_nowait({"type": "message", "data": "allowed event"})
        await asyncio.wait_for(socket.delivered.wait(), 1)
        assert socket.sent == ["allowed event"]
        assert socket.closed == []
    finally:
        await stop(task)


@pytest.mark.asyncio
async def test_non_object_json_does_not_crash_the_endpoint(monkeypatch):
    socket, _, _, _, task = await prepare(monkeypatch)
    try:
        for payload in ("null", "[]", '"text"', "123", '{"type":[]}', '{"type":{}}', '{"type":"ping"}'):
            socket.incoming.put_nowait(payload)
        await asyncio.wait_for(socket.delivered.wait(), 1)
        assert socket.sent == [{"type": "pong"}]
        assert not task.done()
    finally:
        await stop(task)


@pytest.mark.asyncio
async def test_oversized_client_frame_is_closed_before_json_processing(monkeypatch):
    socket, _, _, _, task = await prepare(monkeypatch)
    try:
        socket.incoming.put_nowait("x" * 4097)
        await asyncio.wait_for(socket.delivered.wait(), 1)
        assert socket.closed == [1009]
    finally:
        await stop(task)
