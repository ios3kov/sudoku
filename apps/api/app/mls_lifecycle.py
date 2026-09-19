import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Conversation,
    ConversationMember,
    ConversationMembershipChange,
    OutboxEvent,
)


async def schedule_mls_device_change(
    db: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    kind: str,
) -> list[uuid.UUID]:
    if kind not in {"device_add", "device_remove"}:
        raise ValueError("Unsupported MLS device change kind")

    conversation_ids = (
        await db.execute(
            select(Conversation.id)
            .join(
                ConversationMember,
                ConversationMember.conversation_id == Conversation.id,
            )
            .where(
                ConversationMember.user_id == user_id,
                ConversationMember.e2ee_state != "pending_add",
                Conversation.encryption_required.is_(True),
                Conversation.e2ee_ready.is_(True),
            )
        )
    ).scalars().all()

    scheduled: list[uuid.UUID] = []
    for conversation_id in conversation_ids:
        pending = (
            await db.execute(
                select(ConversationMembershipChange.id).where(
                    ConversationMembershipChange.conversation_id == conversation_id,
                    ConversationMembershipChange.status == "pending",
                )
            )
        ).scalar_one_or_none()
        if pending is not None:
            continue

        change = ConversationMembershipChange(
            conversation_id=conversation_id,
            target_user_id=user_id,
            target_device_id=device_id,
            requested_by=user_id,
            kind=kind,
            status="pending",
        )
        db.add(change)
        await db.flush()
        db.add(
            OutboxEvent(
                event_type="mls.device.changed",
                aggregate_type="mls_device",
                aggregate_id=change.id,
                conversation_id=conversation_id,
                payload={
                    "change_id": str(change.id),
                    "user_id": str(user_id),
                    "device_id": str(device_id),
                    "kind": kind,
                },
            )
        )
        scheduled.append(change.id)
    return scheduled
