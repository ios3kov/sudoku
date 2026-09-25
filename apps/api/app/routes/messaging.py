import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..contacts import require_contacts
from ..db import get_db
from ..deps import AuthContext, get_auth_context
from ..rate_limit import enforce_user_rate_limit
from ..metrics import record_message_created
from ..models import (
    Conversation,
    ConversationMember,
    ConversationTransportEvent,
    ConversationMembershipChange,
    MlsControlEvent,
    Message,
    MessageReaction,
    User,
    UserContact,
    AuditEvent,
    Asset,
    MessageAsset,
)
from ..schemas import (
    ConversationResponse,
    CreateConversationRequest,
    CreateMessageRequest,
    EditMessageRequest,
    MessageResponse,
    ReactionRequest,
    ReadRequest,
    UserDirectoryItem,
    UpdateConversationRequest,
    ConversationMembersRequest,
    ConversationMemberRoleRequest,
    ConversationPreferencesRequest,
)

from .messaging_support import (
    conversation_response,
    emit,
    require_group_owner,
    require_membership,
    response_message,
    serialize_message,
)

router = APIRouter(prefix="/v1", tags=["messaging"])
settings = get_settings()


@router.get("/users", response_model=list[UserDirectoryItem])
async def user_directory(
    q: str = Query(default="", max_length=120),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "user-search", 60, 60)
    term = q.strip().casefold()
    query = (
        select(User)
        .join(UserContact, UserContact.contact_user_id == User.id)
        .where(
            UserContact.owner_user_id == auth.user.id,
            User.status == "active",
            User.phone_e164.is_not(None),
            User.phone_verified_at.is_not(None),
            User.id != auth.user.id,
        )
    )
    if term:
        escaped = term.replace("%", "\\%").replace("_", "\\_")
        query = query.where(
            or_(
                func.lower(User.display_name).like(f"%{escaped}%", escape="\\"),
                User.phone_e164.like(f"%{escaped}%", escape="\\"),
            )
        )
    users = (await db.execute(query.order_by(User.display_name).limit(100))).scalars().all()
    return [
        UserDirectoryItem(
            id=user.id,
            display_name=user.display_name,
            phone_e164=user.phone_e164,
        )
        for user in users
    ]


@router.post("/conversations", response_model=ConversationResponse, status_code=201)
async def create_conversation(
    payload: CreateConversationRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-create", 20, 60)
    if settings.require_e2ee_new_conversations and not payload.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="New conversations must use end-to-end encryption",
        )
    member_ids = set(payload.member_ids)
    member_ids.discard(auth.user.id)
    if payload.type == "direct" and len(member_ids) != 1:
        raise HTTPException(status_code=422, detail="Direct conversation requires exactly one other member")
    if payload.type == "group" and len(member_ids) < 1:
        raise HTTPException(status_code=422, detail="Group requires at least one other member")
    if payload.type == "group" and not (payload.title and payload.title.strip()):
        raise HTTPException(status_code=422, detail="Group title is required")
    if len(member_ids) + 1 > 100:
        raise HTTPException(status_code=422, detail="Group member limit is 100")

    valid_ids = set((await db.execute(select(User.id).where(User.id.in_(member_ids), User.status == "active"))).scalars().all())
    if valid_ids != member_ids:
        raise HTTPException(status_code=422, detail="One or more members are invalid")
    await require_contacts(db, auth.user.id, member_ids)

    direct_key = None
    if payload.type == "direct":
        other = next(iter(member_ids))
        direct_key = ":".join(sorted([str(auth.user.id), str(other)]))
        # Serialize creation for this user pair so two concurrent clients cannot race the unique direct_key.
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:direct_key, 0))"), {"direct_key": direct_key})
        existing = (await db.execute(select(Conversation).where(Conversation.direct_key == direct_key))).scalar_one_or_none()
        if existing is not None:
            if existing.encryption_required != payload.encryption_required:
                raise HTTPException(
                    status_code=409,
                    detail="Existing direct conversation encryption mode does not match request",
                )
            # A direct chat is unique for the user pair. Either participant may
            # resolve the same pending row so contact taps can open it
            # immediately while the creator finishes MLS bootstrap.
            membership = await require_membership(db, existing.id, auth.user.id)
            return await conversation_response(db, existing, membership)

    conversation = Conversation(
        type=payload.type,
        title=payload.title.strip() if payload.title else None,
        direct_key=direct_key,
        created_by=auth.user.id,
        next_sequence=1,
        encryption_required=payload.encryption_required,
        e2ee_ready=not payload.encryption_required,
    )
    db.add(conversation)
    await db.flush()
    db.add(ConversationMember(conversation_id=conversation.id, user_id=auth.user.id, role="owner"))
    for member_id in member_ids:
        db.add(ConversationMember(conversation_id=conversation.id, user_id=member_id, role="member"))
    if conversation.e2ee_ready:
        await emit(
            db,
            "conversation.created",
            conversation.id,
            "conversation",
            conversation.id,
            {"conversation_id": str(conversation.id), "type": conversation.type, "title": conversation.title},
        )
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="conversation.created", target_type="conversation", target_id=conversation.id))
    await db.commit()
    await db.refresh(conversation)
    membership = await require_membership(db, conversation.id, auth.user.id)
    return await conversation_response(db, conversation, membership)


@router.patch("/conversations/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: uuid.UUID,
    payload: UpdateConversationRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-update", 60, 60)
    conversation, member = await require_group_owner(db, conversation_id, auth.user.id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Group title is required")
    conversation.title = title
    await emit(
        db,
        "conversation.updated",
        conversation.id,
        "conversation",
        conversation.id,
        {"conversation_id": str(conversation.id), "title": conversation.title},
    )
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="conversation.updated", target_type="conversation", target_id=conversation.id))
    await db.commit()
    return await conversation_response(db, conversation, member)


@router.post("/conversations/{conversation_id}/members", response_model=ConversationResponse)
async def add_conversation_members(
    conversation_id: uuid.UUID,
    payload: ConversationMembersRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-member-add", 30, 60)
    conversation, owner_membership = await require_group_owner(db, conversation_id, auth.user.id)
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="E2EE group membership must use MLS membership transitions",
        )
    requested_ids = set(payload.user_ids)
    requested_ids.discard(auth.user.id)
    if not requested_ids:
        raise HTTPException(status_code=422, detail="No members to add")

    existing_ids = set(
        (await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conversation_id)))
        .scalars()
        .all()
    )
    new_ids = requested_ids - existing_ids
    if len(existing_ids) + len(new_ids) > 100:
        raise HTTPException(status_code=422, detail="Group member limit is 100")
    valid_ids = set(
        (await db.execute(select(User.id).where(User.id.in_(new_ids), User.status == "active"))).scalars().all()
    )
    if valid_ids != new_ids:
        raise HTTPException(status_code=422, detail="One or more members are invalid")
    await require_contacts(db, auth.user.id, new_ids)

    for user_id in new_ids:
        db.add(ConversationMember(conversation_id=conversation_id, user_id=user_id, role="member"))
    if new_ids:
        await emit(
            db,
            "conversation.members_added",
            conversation_id,
            "conversation",
            conversation_id,
            {"conversation_id": str(conversation_id), "user_ids": [str(item) for item in sorted(new_ids, key=str)]},
            extra_recipient_ids=list(new_ids),
        )
        db.add(AuditEvent(actor_user_id=auth.user.id, event_type="conversation.members_added", target_type="conversation", target_id=conversation_id))
    await db.commit()
    return await conversation_response(db, conversation, owner_membership)


@router.patch("/conversations/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
async def update_conversation_member_role(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: ConversationMemberRoleRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-member-role", 30, 60)
    conversation, owner_membership = await require_group_owner(db, conversation_id, auth.user.id)
    target = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.role == payload.role:
        return await conversation_response(db, conversation, owner_membership)
    if target.role == "owner" and payload.role == "member":
        owner_count = await db.scalar(
            select(func.count()).select_from(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.role == "owner",
            )
        )
        if int(owner_count or 0) <= 1:
            raise HTTPException(status_code=409, detail="Group must keep at least one owner")
    target.role = payload.role
    await emit(
        db,
        "conversation.member_role_updated",
        conversation_id,
        "conversation",
        conversation_id,
        {"conversation_id": str(conversation_id), "user_id": str(user_id), "role": payload.role},
    )
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="conversation.member_role_updated", target_type="conversation", target_id=conversation_id))
    await db.commit()
    return await conversation_response(db, conversation, owner_membership)


@router.delete("/conversations/{conversation_id}/members/{user_id}", status_code=204)
async def remove_conversation_member(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-member-remove", 30, 60)
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == conversation_id).with_for_update())
    ).scalar_one_or_none()
    if conversation is None or conversation.type != "group":
        raise HTTPException(status_code=404, detail="Group not found")
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="E2EE group membership must use MLS membership transitions",
        )
    actor_membership = await require_membership(db, conversation_id, auth.user.id)
    target = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    self_leave = user_id == auth.user.id
    if not self_leave and actor_membership.role != "owner":
        raise HTTPException(status_code=403, detail="Group owner access required")
    if target.role == "owner":
        owner_count = await db.scalar(
            select(func.count()).select_from(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.role == "owner",
            )
        )
        if int(owner_count or 0) <= 1:
            raise HTTPException(status_code=409, detail="Transfer ownership before removing the last owner")

    await db.delete(target)
    await db.flush()
    await emit(
        db,
        "conversation.member_removed",
        conversation_id,
        "conversation",
        conversation_id,
        {"conversation_id": str(conversation_id), "user_id": str(user_id)},
        extra_recipient_ids=[user_id],
    )
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="conversation.member_removed", target_type="conversation", target_id=conversation_id))
    await db.commit()


@router.patch("/conversations/{conversation_id}/preferences", response_model=ConversationResponse)
async def update_conversation_preferences(
    conversation_id: uuid.UUID,
    payload: ConversationPreferencesRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "conversation-preferences", 60, 60)
    if payload.is_pinned is None and payload.notifications_muted is None:
        raise HTTPException(status_code=422, detail="At least one preference is required")
    membership = await require_membership(db, conversation_id, auth.user.id)
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if payload.is_pinned is not None:
        membership.is_pinned = payload.is_pinned
    if payload.notifications_muted is not None:
        membership.notifications_muted = payload.notifications_muted
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="conversation.preferences_updated",
            target_type="conversation",
            target_id=conversation_id,
        )
    )
    await db.commit()
    return await conversation_response(db, conversation, membership)


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(auth: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Conversation, ConversationMember)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
                or_(
                    Conversation.e2ee_ready.is_(True),
                    Conversation.created_by == auth.user.id,
                ),
            )
            .order_by(ConversationMember.is_pinned.desc(), Conversation.created_at.desc())
        )
    ).all()
    responses: list[ConversationResponse] = []
    for conversation, member in rows:
        responses.append(await conversation_response(db, conversation, member))
    return responses


@router.get("/conversations/{conversation_id}/search", response_model=list[MessageResponse])
async def search_messages(
    conversation_id: uuid.UUID,
    q: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=30, ge=1, le=50),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "message-search", 60, 60)
    await require_membership(db, conversation_id, auth.user.id)
    term = q.strip()
    if len(term) < 2:
        raise HTTPException(status_code=422, detail="Search query is too short")
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="Server-side content search is unavailable for E2EE conversations",
        )

    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    messages = (
        await db.execute(
            select(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.deleted_at.is_(None),
                Message.body_text.is_not(None),
                Message.body_text.ilike(f"%{escaped}%", escape="\\"),
            )
            .order_by(Message.sequence.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [await response_message(db, message) for message in messages]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    conversation_id: uuid.UUID,
    before: int | None = Query(default=None, ge=1),
    after: int | None = Query(default=None, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, conversation_id, auth.user.id)
    query = select(Message).where(Message.conversation_id == conversation_id)
    if before is not None:
        query = query.where(Message.sequence < before)
    if after is not None:
        query = query.where(Message.sequence > after)
    if after is not None:
        query = query.order_by(Message.sequence.asc()).limit(limit)
    else:
        query = query.order_by(Message.sequence.desc()).limit(limit)
    messages = (await db.execute(query)).scalars().all()
    if after is None:
        messages = list(reversed(messages))
    return [await response_message(db, message) for message in messages]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse, status_code=201)
async def create_message(
    conversation_id: uuid.UUID,
    payload: CreateMessageRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "message-create", 120, 60)
    await require_membership(db, conversation_id, auth.user.id)
    body = payload.body.strip() if payload.body is not None else None
    conversation_for_policy = (await db.execute(select(Conversation).where(Conversation.id == conversation_id))).scalar_one_or_none()
    if conversation_for_policy is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation_for_policy.type == "direct":
        other_user_id = (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id != auth.user.id,
                    ConversationMember.e2ee_state != "pending_add",
                )
            )
        ).scalar_one_or_none()
        if other_user_id is not None:
            await require_contacts(db, auth.user.id, {other_user_id})
    if conversation_for_policy.encryption_required:
        if not conversation_for_policy.e2ee_ready:
            raise HTTPException(
                status_code=409,
                detail="Secure conversation setup is not active yet",
            )
        pending_change = (
            await db.execute(
                select(
                    ConversationMembershipChange.id,
                    ConversationMembershipChange.kind,
                ).where(
                    ConversationMembershipChange.conversation_id == conversation_id,
                    ConversationMembershipChange.status == "pending",
                )
            )
        ).first()
        if pending_change is not None:
            pending_change_id, pending_change_kind = pending_change
            if pending_change_kind == "device_remove":
                raise HTTPException(
                    status_code=409,
                    detail="MLS device removal rekey is required before sending",
                )
            delivery_started = (
                await db.execute(
                    select(MlsControlEvent.id)
                    .where(MlsControlEvent.membership_change_id == pending_change_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if delivery_started is not None:
                raise HTTPException(
                    status_code=409,
                    detail="MLS membership transition delivery is in progress",
                )
        if body is not None or payload.envelope is None:
            raise HTTPException(status_code=422, detail="E2EE conversation requires ciphertext envelope and forbids plaintext body")
    elif payload.envelope is not None:
        raise HTTPException(status_code=422, detail="Ciphertext envelope requires an E2EE conversation")
    if payload.type == "text" and not body and not conversation_for_policy.encryption_required:
        raise HTTPException(status_code=422, detail="Text message body is required")
    if payload.type != "text" and not payload.asset_ids:
        raise HTTPException(status_code=422, detail="Attachment message requires at least one asset")

    unique_asset_ids = list(dict.fromkeys(payload.asset_ids))
    assets: list[Asset] = []
    if unique_asset_ids:
        assets = (
            await db.execute(
                select(Asset).where(
                    Asset.id.in_(unique_asset_ids),
                    Asset.owner_id == auth.user.id,
                    Asset.status == "ready",
                )
            )
        ).scalars().all()
        if {asset.id for asset in assets} != set(unique_asset_ids):
            raise HTTPException(status_code=422, detail="One or more assets are unavailable")
        if conversation_for_policy.encryption_required:
            if any(not asset.e2ee_ciphertext for asset in assets):
                raise HTTPException(
                    status_code=422,
                    detail="E2EE conversations require ciphertext-only assets",
                )
        else:
            if any(asset.e2ee_ciphertext for asset in assets):
                raise HTTPException(
                    status_code=422,
                    detail="Ciphertext assets require an E2EE conversation",
                )
            if payload.type == "image" and any(not asset.mime_type.startswith("image/") for asset in assets):
                raise HTTPException(status_code=422, detail="Image message contains a non-image asset")
            if payload.type == "voice" and (len(assets) != 1 or not assets[0].mime_type.startswith("audio/")):
                raise HTTPException(status_code=422, detail="Voice message requires exactly one audio asset")

    existing = (
        await db.execute(select(Message).where(Message.sender_id == auth.user.id, Message.client_id == payload.client_id))
    ).scalar_one_or_none()
    if existing is not None:
        return await response_message(db, existing)

    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == conversation_id).with_for_update())
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Re-check after acquiring the conversation lock so concurrent retries cannot consume a sequence twice.
    existing = (
        await db.execute(select(Message).where(Message.sender_id == auth.user.id, Message.client_id == payload.client_id))
    ).scalar_one_or_none()
    if existing is not None:
        return await response_message(db, existing)

    if payload.reply_to is not None:
        reply_exists = (
            await db.execute(
                select(Message.id).where(Message.id == payload.reply_to, Message.conversation_id == conversation_id)
            )
        ).scalar_one_or_none()
        if reply_exists is None:
            raise HTTPException(status_code=422, detail="Reply target is invalid")

    sequence = conversation.next_sequence
    conversation.next_sequence += 1
    message = Message(
        conversation_id=conversation_id,
        sender_id=auth.user.id,
        client_id=payload.client_id,
        sequence=sequence,
        type=payload.type,
        body_text=None if conversation.encryption_required else body,
        envelope=payload.envelope if conversation.encryption_required else None,
        encryption_version=1 if conversation.encryption_required else 0,
        reply_to=payload.reply_to,
    )
    db.add(message)
    await db.flush()
    transport_sequence = conversation.next_transport_sequence
    conversation.next_transport_sequence += 1
    db.add(
        ConversationTransportEvent(
            conversation_id=conversation_id,
            sequence=transport_sequence,
            kind="message",
            message_id=message.id,
        )
    )
    for position, asset_id in enumerate(unique_asset_ids):
        db.add(MessageAsset(message_id=message.id, asset_id=asset_id, position=position))
    await db.flush()
    await db.refresh(message)
    payload_json = await serialize_message(db, message)
    await emit(db, "message.created", conversation_id, "message", message.id, payload_json)
    await db.commit()
    record_message_created(message.type)
    return MessageResponse(**payload_json)


@router.patch("/messages/{message_id}", response_model=MessageResponse)
async def edit_message(
    message_id: uuid.UUID,
    payload: EditMessageRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "message-edit", 120, 60)
    message = (await db.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    await require_membership(db, message.conversation_id, auth.user.id)
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == message.conversation_id))
    ).scalar_one()
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="E2EE message edits must be sent as encrypted application events",
        )
    if message.sender_id != auth.user.id or message.deleted_at is not None:
        raise HTTPException(status_code=403, detail="Message cannot be edited")
    message.body_text = payload.body
    message.edited_at = datetime.now(UTC)
    await db.flush()
    await emit(db, "message.updated", message.conversation_id, "message", message.id, await serialize_message(db, message))
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="message.edited", target_type="message", target_id=message.id))
    await db.commit()
    return await response_message(db, message)


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(
    message_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "message-delete", 120, 60)
    message = (await db.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    await require_membership(db, message.conversation_id, auth.user.id)
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == message.conversation_id))
    ).scalar_one()
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="E2EE message deletes must be sent as encrypted application events",
        )
    if message.sender_id != auth.user.id:
        raise HTTPException(status_code=403, detail="Message cannot be deleted")
    if message.deleted_at is None:
        message.deleted_at = datetime.now(UTC)
        message.body_text = None
        await db.flush()
        await emit(db, "message.deleted", message.conversation_id, "message", message.id, await serialize_message(db, message))
        db.add(AuditEvent(actor_user_id=auth.user.id, event_type="message.deleted", target_type="message", target_id=message.id))
        await db.commit()


@router.post("/messages/{message_id}/reactions", status_code=204)
async def toggle_reaction(
    message_id: uuid.UUID,
    payload: ReactionRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "reaction-toggle", 240, 60)
    message = (await db.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    await require_membership(db, message.conversation_id, auth.user.id)
    conversation = (
        await db.execute(select(Conversation).where(Conversation.id == message.conversation_id))
    ).scalar_one()
    if conversation.encryption_required:
        raise HTTPException(
            status_code=409,
            detail="E2EE reactions must be sent as encrypted application events",
        )
    reaction = (
        await db.execute(
            select(MessageReaction).where(
                MessageReaction.message_id == message_id,
                MessageReaction.user_id == auth.user.id,
                MessageReaction.emoji == payload.emoji,
            )
        )
    ).scalar_one_or_none()
    if reaction is None:
        db.add(MessageReaction(message_id=message_id, user_id=auth.user.id, emoji=payload.emoji))
        active = True
    else:
        await db.delete(reaction)
        active = False
    await emit(
        db,
        "reaction.updated",
        message.conversation_id,
        "message",
        message.id,
        {"message_id": str(message.id), "user_id": str(auth.user.id), "emoji": payload.emoji, "active": active},
    )
    await db.commit()


@router.post("/conversations/{conversation_id}/read", status_code=204)
async def mark_read(
    conversation_id: uuid.UUID,
    payload: ReadRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    member = await require_membership(db, conversation_id, auth.user.id)
    latest = (
        await db.execute(select(func.max(Message.sequence)).where(Message.conversation_id == conversation_id))
    ).scalar_one_or_none() or 0
    sequence = min(payload.sequence, latest)
    if sequence > member.last_read_sequence:
        member.last_read_sequence = sequence
        await emit(
            db,
            "receipt.updated",
            conversation_id,
            "conversation",
            conversation_id,
            {"user_id": str(auth.user.id), "last_read_sequence": sequence},
        )
        await db.commit()
