import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Asset,
    Conversation,
    ConversationMember,
    Message,
    MessageAsset,
    MessageReaction,
    OutboxEvent,
    User,
)
from ..schemas import (
    ConversationMemberResponse,
    ConversationResponse,
    MessageResponse,
)


def serialize_asset(asset: Asset) -> dict:
    return {
        "id": str(asset.id),
        "mime_type": asset.mime_type,
        "size_bytes": asset.size_bytes,
        "filename": asset.filename,
        "e2ee_ciphertext": asset.e2ee_ciphertext,
        "status": asset.status,
        "content_url": f"/v1/assets/{asset.id}/content",
    }


async def serialize_message(db: AsyncSession, message: Message) -> dict:
    assets = (
        await db.execute(
            select(Asset)
            .join(MessageAsset, MessageAsset.asset_id == Asset.id)
            .where(MessageAsset.message_id == message.id)
            .order_by(MessageAsset.position)
        )
    ).scalars().all()
    reaction_rows = (
        await db.execute(
            select(MessageReaction.emoji, MessageReaction.user_id).where(
                MessageReaction.message_id == message.id
            )
        )
    ).all()
    grouped_reactions: dict[str, list[str]] = {}
    for emoji, user_id in reaction_rows:
        grouped_reactions.setdefault(emoji, []).append(str(user_id))
    return {
        "id": str(message.id),
        "conversation_id": str(message.conversation_id),
        "sender_id": str(message.sender_id),
        "client_id": str(message.client_id),
        "sequence": message.sequence,
        "type": message.type,
        "body": None if message.deleted_at else message.body_text,
        "envelope": None if message.deleted_at else message.envelope,
        "reply_to": str(message.reply_to) if message.reply_to else None,
        "created_at": message.created_at.isoformat(),
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
        "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
        "assets": [serialize_asset(asset) for asset in assets],
        "reactions": [
            {"emoji": emoji, "user_ids": user_ids}
            for emoji, user_ids in grouped_reactions.items()
        ],
    }


async def response_message(db: AsyncSession, message: Message) -> MessageResponse:
    return MessageResponse(**(await serialize_message(db, message)))


async def conversation_members_response(
    db: AsyncSession,
    conversation_id: uuid.UUID,
) -> list[ConversationMemberResponse]:
    rows = (
        await db.execute(
            select(User, ConversationMember.role, ConversationMember.last_read_sequence)
            .join(ConversationMember, ConversationMember.user_id == User.id)
            .where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.e2ee_state != "pending_add",
            )
            .order_by(User.display_name)
        )
    ).all()
    return [
        ConversationMemberResponse(
            id=user.id,
            display_name=user.display_name,
            email=user.email,
            role=role,
            last_read_sequence=last_read_sequence,
        )
        for user, role, last_read_sequence in rows
    ]


async def conversation_response(
    db: AsyncSession,
    conversation: Conversation,
    membership: ConversationMember,
) -> ConversationResponse:
    return ConversationResponse(
        id=conversation.id,
        type=conversation.type,
        title=conversation.title,
        created_by=conversation.created_by,
        created_at=conversation.created_at,
        last_read_sequence=membership.last_read_sequence,
        latest_sequence=max(0, conversation.next_sequence - 1),
        is_pinned=membership.is_pinned,
        notifications_muted=membership.notifications_muted,
        encryption_required=conversation.encryption_required,
        e2ee_ready=conversation.e2ee_ready,
        members=await conversation_members_response(db, conversation.id),
    )


async def require_membership(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> ConversationMember:
    member = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return member


async def emit(
    db: AsyncSession,
    event_type: str,
    conversation_id: uuid.UUID,
    aggregate_type: str,
    aggregate_id: uuid.UUID,
    payload: dict,
    extra_recipient_ids: list[uuid.UUID] | None = None,
) -> None:
    event_payload = dict(payload)
    if extra_recipient_ids:
        event_payload["_extra_recipient_ids"] = [str(item) for item in extra_recipient_ids]
    db.add(
        OutboxEvent(
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            conversation_id=conversation_id,
            payload=event_payload,
        )
    )


async def require_group_owner(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> tuple[Conversation, ConversationMember]:
    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if conversation is None or conversation.type != "group":
        raise HTTPException(status_code=404, detail="Group not found")
    member = await require_membership(db, conversation_id, user_id)
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Group owner access required")
    return conversation, member
