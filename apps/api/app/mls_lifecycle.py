import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Conversation,
    ConversationMember,
    ConversationMembershipChange,
    OutboxEvent,
)


def _wake_event(change: ConversationMembershipChange) -> OutboxEvent:
    return OutboxEvent(
        event_type="mls.device.changed",
        aggregate_type="mls_device",
        aggregate_id=change.id,
        conversation_id=change.conversation_id,
        payload={
            "change_id": str(change.id),
            "user_id": str(change.target_user_id),
            "device_id": str(change.target_device_id) if change.target_device_id else None,
            "kind": change.kind,
        },
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
        duplicate = (
            await db.execute(
                select(ConversationMembershipChange.id).where(
                    ConversationMembershipChange.conversation_id == conversation_id,
                    ConversationMembershipChange.target_user_id == user_id,
                    ConversationMembershipChange.target_device_id == device_id,
                    ConversationMembershipChange.kind == kind,
                    ConversationMembershipChange.status.in_(("pending", "queued")),
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            continue

        pending = (
            await db.execute(
                select(ConversationMembershipChange.id).where(
                    ConversationMembershipChange.conversation_id == conversation_id,
                    ConversationMembershipChange.status == "pending",
                )
            )
        ).scalar_one_or_none()
        status_value = "queued" if pending is not None else "pending"
        change = ConversationMembershipChange(
            conversation_id=conversation_id,
            target_user_id=user_id,
            target_device_id=device_id,
            requested_by=user_id,
            kind=kind,
            status=status_value,
        )
        db.add(change)
        await db.flush()
        if status_value == "pending":
            db.add(_wake_event(change))
        scheduled.append(change.id)
    return scheduled


async def promote_next_mls_change(
    db: AsyncSession,
    conversation_id: uuid.UUID,
) -> ConversationMembershipChange | None:
    queued = (
        await db.execute(
            select(ConversationMembershipChange)
            .where(
                ConversationMembershipChange.conversation_id == conversation_id,
                ConversationMembershipChange.status == "queued",
            )
            .order_by(ConversationMembershipChange.created_at, ConversationMembershipChange.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
    ).scalar_one_or_none()
    if queued is None:
        return None
    queued.status = "pending"
    db.add(_wake_event(queued))
    return queued
