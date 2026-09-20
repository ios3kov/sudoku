import json
import uuid
from datetime import UTC, datetime

from redis import Redis
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session as SyncSession

from ..config import get_settings
from ..metrics import record_outbox_published
from ..models import ConversationMember, OutboxEvent
from ..worker import celery_app

settings = get_settings()
sync_db_url = settings.database_url.replace("+asyncpg", "+psycopg")
engine = create_engine(sync_db_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
redis = Redis.from_url(settings.redis_url, decode_responses=True)


@celery_app.task(name="app.tasks.outbox.dispatch_outbox_batch")
def dispatch_outbox_batch(batch_size: int = 100) -> int:
    published = 0
    with SyncSession(engine) as db:
        events = (
            db.execute(
                select(OutboxEvent)
                .where(OutboxEvent.published_at.is_(None))
                .order_by(OutboxEvent.created_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()

        for event in events:
            if event.conversation_id is None:
                event.published_at = datetime.now(UTC)
                record_outbox_published(event.event_type)
                published += 1
                continue

            current_user_ids = set(
                db.execute(
                    select(ConversationMember.user_id).where(
                        ConversationMember.conversation_id == event.conversation_id,
                        ConversationMember.e2ee_state != "pending_add",
                    )
                ).scalars().all()
            )
            payload = dict(event.payload or {})
            extra_user_ids: set[uuid.UUID] = set()
            for raw_user_id in payload.pop("_extra_recipient_ids", []):
                try:
                    extra_user_ids.add(uuid.UUID(str(raw_user_id)))
                except (TypeError, ValueError):
                    continue
            user_ids = current_user_ids | extra_user_ids
            envelope = json.dumps(
                {
                    "event_id": str(event.id),
                    "type": event.event_type,
                    "conversation_id": str(event.conversation_id),
                    "payload": payload,
                },
                separators=(",", ":"),
            )
            for user_id in user_ids:
                redis.publish(f"rt:user:{user_id}", envelope)
            if event.event_type == "message.created":
                celery_app.send_task("app.tasks.push.send_push_for_event", args=[str(event.id)])
            event.published_at = datetime.now(UTC)
            record_outbox_published(event.event_type)
            published += 1

        db.commit()
    return published
