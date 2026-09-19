import json
import uuid
from datetime import UTC, datetime

from pywebpush import WebPushException, webpush
from redis import Redis
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as SyncSession

from ..config import get_settings
from ..metrics import record_push_failed, record_push_sent
from ..models import ConversationMember, OutboxEvent, PushSubscription
from ..worker import celery_app

settings = get_settings()
sync_db_url = settings.database_url.replace("+asyncpg", "+psycopg")
engine = create_engine(sync_db_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
redis = Redis.from_url(settings.redis_url, decode_responses=True)


@celery_app.task(
    name="app.tasks.push.send_push_for_event",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 5},
)
def send_push_for_event(event_id: str) -> int:
    if not settings.vapid_private_key or not settings.vapid_subject:
        return 0

    parsed_event_id = uuid.UUID(event_id)
    sent = 0
    with SyncSession(engine) as db:
        event = db.get(OutboxEvent, parsed_event_id)
        if event is None or event.event_type != "message.created" or event.conversation_id is None:
            return 0

        sender_id_raw = str((event.payload or {}).get("sender_id", ""))
        try:
            sender_id = uuid.UUID(sender_id_raw)
        except ValueError:
            return 0

        recipient_ids = db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == event.conversation_id,
                ConversationMember.user_id != sender_id,
                ConversationMember.notifications_muted.is_(False),
            )
        ).scalars().all()

        subscriptions = db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id.in_(recipient_ids),
                PushSubscription.revoked_at.is_(None),
            )
        ).scalars().all()

        payload = json.dumps(
            {
                "title": "Sudoku",
                "body": "A new Sudoku challenge is available",
                "url": "/",
            },
            separators=(",", ":"),
        )

        for subscription in subscriptions:
            # Avoid redundant notification noise while the recipient is actively connected.
            if redis.exists(f"presence:user:{subscription.user_id}"):
                continue
            try:
                webpush(
                    subscription_info={
                        "endpoint": subscription.endpoint,
                        "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                    },
                    data=payload,
                    vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=300,
                )
                sent += 1
                record_push_sent()
            except WebPushException as exc:
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None)
                if status_code in {404, 410}:
                    record_push_failed("subscription_gone")
                    subscription.revoked_at = datetime.now(UTC)
                    continue
                record_push_failed("provider_error")
                raise

        db.commit()
    return sent
