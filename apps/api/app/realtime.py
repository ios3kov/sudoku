import asyncio
import json
import time
import uuid
from collections import deque
from contextlib import suppress
from datetime import UTC, datetime
from urllib.parse import urlparse

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis
from sqlalchemy import select

from .config import get_settings
from .db import SessionFactory
from .device_pin import DevicePinLocked, pin_allows
from .metrics import websocket_connection_delta
from .models import ConversationMember, Session, User
from .security import hash_secret

router = APIRouter()
settings = get_settings()
redis = Redis.from_url(settings.redis_url, decode_responses=True)
_parsed_origin = urlparse(settings.public_origin)
EXPECTED_ORIGIN = f"{_parsed_origin.scheme}://{_parsed_origin.netloc}"
SESSION_CHECK_SECONDS = 30
MAX_CLIENT_FRAME_CHARS = 4096


def websocket_unlock_token(websocket: WebSocket) -> str | None:
    # Never carry credentials in URLs. Echo only the public protocol name.
    protocols = websocket.headers.get("sec-websocket-protocol", "").split(",")
    matches = [p.strip()[len("sudoku-unlock."):] for p in protocols if p.strip().startswith("sudoku-unlock.")]
    return matches[0] if len(matches) == 1 and 32 <= len(matches[0]) <= 128 else None


async def accept_socket(websocket: WebSocket) -> None:
    if "sudoku.v1" in [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",")]:
        await websocket.accept(subprotocol="sudoku.v1")
    else:
        await websocket.accept()


async def authenticate_websocket(websocket: WebSocket) -> tuple[User, uuid.UUID] | None:
    token = websocket.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    async with SessionFactory() as db:
        row = (
            await db.execute(
                select(Session, User)
                .join(User, User.id == Session.user_id)
                .where(
                    Session.token_hash == hash_secret(token),
                    Session.revoked_at.is_(None),
                    Session.expires_at > datetime.now(UTC),
                    User.status == "active",
                )
            )
        ).first()
        if row and not await pin_allows(db, row[0].id, websocket_unlock_token(websocket)):
            raise DevicePinLocked()
        return (row[1], row[0].id) if row else None


async def session_still_valid(session_id: uuid.UUID, user_id: uuid.UUID, unlock_token: str | None = None) -> bool:
    async with SessionFactory() as db:
        value = (
            await db.execute(
                select(Session.id)
                .join(User, User.id == Session.user_id)
                .where(
                    Session.id == session_id,
                    Session.user_id == user_id,
                    Session.revoked_at.is_(None),
                    Session.expires_at > datetime.now(UTC),
                    User.status == "active",
                )
            )
        ).scalar_one_or_none()
        if value is not None and not await pin_allows(db, session_id, unlock_token):
            raise DevicePinLocked()
        return value is not None


async def publish_typing(user: User, conversation_id: uuid.UUID, event_type: str) -> bool:
    async with SessionFactory() as db:
        membership = (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id == user.id,
                    ConversationMember.e2ee_state != "pending_add",
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            return False
        recipients = (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id != user.id,
                    ConversationMember.e2ee_state != "pending_add",
                )
            )
        ).scalars().all()
    envelope=json.dumps({"type":event_type,"conversation_id":str(conversation_id),"payload":{"user_id":str(user.id)}},separators=(",",":"))
    for recipient in recipients:
        await redis.publish(f"rt:user:{recipient}", envelope)
    return True


@router.websocket("/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    if websocket.headers.get("origin") != EXPECTED_ORIGIN:
        await websocket.close(code=4403)
        return

    try:
        authenticated = await authenticate_websocket(websocket)
    except DevicePinLocked:
        await accept_socket(websocket)
        await websocket.close(code=4423)
        return
    if authenticated is None:
        await websocket.close(code=4401)
        return

    user, session_id = authenticated
    unlock_token = websocket_unlock_token(websocket)
    await accept_socket(websocket)
    websocket_connection_delta(1)

    pubsub = redis.pubsub()
    channel = f"rt:user:{user.id}"
    connection_id = uuid.uuid4().hex
    presence_key = f"presence:user:{user.id}:{connection_id}"
    forward_task: asyncio.Task[None] | None = None

    try:
        await pubsub.subscribe(channel)
        await redis.set(presence_key, "1", ex=70)

        async def forward_events() -> None:
            try:
                async for event in pubsub.listen():
                    if event.get("type") == "message":
                        # A client can withhold application pings. Never rely on
                        # client cooperation to revoke server-to-client access.
                        if not await session_still_valid(session_id, user.id, unlock_token):
                            await websocket.close(code=4401)
                            return
                        await websocket.send_text(str(event["data"]))
            except DevicePinLocked:
                await websocket.close(code=4423)
            except Exception:
                # Authentication-store or forwarding failure is fail-closed.
                await websocket.close(code=1011)

        forward_task = asyncio.create_task(forward_events())
        typing_events: deque[float] = deque()

        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=SESSION_CHECK_SECONDS)
            except TimeoutError:
                if not await session_still_valid(session_id, user.id, unlock_token):
                    await websocket.close(code=4401)
                    break
                continue
            if len(raw) > MAX_CLIENT_FRAME_CHARS:
                await websocket.close(code=1009)
                break
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
                continue

            if payload.get("type") == "ping":
                if not await session_still_valid(session_id, user.id, unlock_token):
                    await websocket.close(code=4401)
                    break
                await redis.set(presence_key, "1", ex=70)
                await websocket.send_json({"type": "pong"})
                continue

            if payload.get("type") not in {"typing.started", "typing.stopped"}:
                continue
            if not await session_still_valid(session_id, user.id, unlock_token):
                await websocket.close(code=4401)
                break

            now = time.monotonic()
            while typing_events and now - typing_events[0] > 5.0:
                typing_events.popleft()
            if len(typing_events) >= 20:
                continue
            typing_events.append(now)

            try:
                conversation_id = uuid.UUID(str(payload.get("conversation_id")))
            except (TypeError, ValueError):
                continue
            await publish_typing(user, conversation_id, str(payload["type"]))
    except DevicePinLocked:
        await websocket.close(code=4423)
    except WebSocketDisconnect:
        pass
    finally:
        websocket_connection_delta(-1)
        if forward_task is not None:
            forward_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await forward_task
        with suppress(Exception):
            await pubsub.unsubscribe(channel)
        with suppress(Exception):
            await pubsub.aclose()
        with suppress(Exception):
            await redis.delete(presence_key)
