import asyncio
import json
import time
import uuid
from collections import deque
from datetime import UTC, datetime
from urllib.parse import urlparse

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis
from sqlalchemy import select

from .config import get_settings
from .db import SessionFactory
from .metrics import websocket_connection_delta
from .models import ConversationMember, Session, User
from .security import hash_secret

router = APIRouter()
settings = get_settings()
redis = Redis.from_url(settings.redis_url, decode_responses=True)
_parsed_origin = urlparse(settings.public_origin)
EXPECTED_ORIGIN = f"{_parsed_origin.scheme}://{_parsed_origin.netloc}"


async def authenticate_websocket(websocket: WebSocket) -> User | None:
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
        return row[1] if row else None


async def publish_typing(user: User, conversation_id: uuid.UUID, event_type: str) -> bool:
    async with SessionFactory() as db:
        membership = (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id == user.id,
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
                )
            )
        ).scalars().all()

    envelope = json.dumps(
        {
            "type": event_type,
            "conversation_id": str(conversation_id),
            "payload": {"user_id": str(user.id)},
        },
        separators=(",", ":"),
    )
    for recipient in recipients:
        await redis.publish(f"rt:user:{recipient}", envelope)
    return True


@router.websocket("/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Browser WebSockets carry ambient cookies, so Origin validation is required
    # to prevent cross-site WebSocket hijacking. This app is browser/PWA-only.
    if websocket.headers.get("origin") != EXPECTED_ORIGIN:
        await websocket.close(code=4403)
        return

    user = await authenticate_websocket(websocket)
    if user is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    websocket_connection_delta(1)
    pubsub = redis.pubsub()
    channel = f"rt:user:{user.id}"
    presence_key = f"presence:user:{user.id}"
    await pubsub.subscribe(channel)
    await redis.set(presence_key, "1", ex=70)

    async def forward_events() -> None:
        async for event in pubsub.listen():
            if event.get("type") != "message":
                continue
            await websocket.send_text(str(event["data"]))

    forward_task = asyncio.create_task(forward_events())
    typing_events: deque[float] = deque()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "ping":
                await redis.set(presence_key, "1", ex=70)
                await websocket.send_json({"type": "pong"})
                continue
            if payload.get("type") in {"typing.started", "typing.stopped"}:
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
    except WebSocketDisconnect:
        pass
    finally:
        websocket_connection_delta(-1)
        forward_task.cancel()
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        await redis.delete(presence_key)
