import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, exists, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .deps import AuthContext, get_auth_context
from .models import (
    AuditEvent,
    Conversation,
    ConversationMember,
    ConversationMembershipChange,
    ConversationTransportEvent,
    MlsControlEvent,
    MlsControlRecipient,
    MlsDevice,
    Message,
    MlsKeyPackage,
    OutboxEvent,
    Session,
    User,
)
from .rate_limit import enforce_user_rate_limit
from .mls_lifecycle import promote_next_mls_change, schedule_mls_device_change

from .e2ee_support import (
    ControlEventAckRequest,
    ControlEventBatchCreateRequest,
    ControlEventBatchItemRequest,
    ControlEventCreateRequest,
    DeviceRegistrationRequest,
    KeyPackagePublishRequest,
    active_device,
    control_recipient_pairs_for_change,
    current_active_device_pairs,
    decode_control_payload,
    decode_identity_key,
    decode_key_package,
    encode_bytes,
    require_active_device,
    require_e2ee_group_owner,
    serialize_control_event,
    serialize_membership_change,
)

router = APIRouter(prefix="/v1/e2ee", tags=["e2ee"])

@router.post(
    "/conversations/{conversation_id}/membership-changes/add/{user_id}",
    status_code=201,
)
async def prepare_membership_add(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-member-add-prepare", 30, 60)
    conversation, _ = await require_e2ee_group_owner(
        db, conversation_id, auth.user.id
    )
    if user_id == auth.user.id:
        raise HTTPException(422, "Current user is already a member")

    existing_change = (
        await db.execute(
            select(ConversationMembershipChange).where(
                ConversationMembershipChange.conversation_id == conversation_id,
                ConversationMembershipChange.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if existing_change is not None:
        if existing_change.kind == "add" and existing_change.target_user_id == user_id:
            return serialize_membership_change(existing_change)
        raise HTTPException(status.HTTP_409_CONFLICT, "Another MLS membership transition is pending")

    existing_member = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if existing_member is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "User is already a group member")

    valid_user = (
        await db.execute(
            select(User.id).where(User.id == user_id, User.status == "active")
        )
    ).scalar_one_or_none()
    if valid_user is None:
        raise HTTPException(422, "User is unavailable")

    member_count = await db.scalar(
        select(func.count())
        .select_from(ConversationMember)
        .where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.e2ee_state != "pending_add",
        )
    )
    if int(member_count or 0) >= 100:
        raise HTTPException(422, "Group member limit is 100")

    device_count = await db.scalar(
        select(func.count())
        .select_from(MlsDevice)
        .join(
            Session,
            and_(
                Session.id == MlsDevice.device_id,
                Session.user_id == MlsDevice.user_id,
            ),
        )
        .where(
            MlsDevice.user_id == user_id,
            MlsDevice.revoked_at.is_(None),
            Session.revoked_at.is_(None),
            Session.expires_at > datetime.now(UTC),
        )
    )
    if int(device_count or 0) < 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "User has no active secure device")

    membership = ConversationMember(
        conversation_id=conversation_id,
        user_id=user_id,
        role="member",
        e2ee_state="pending_add",
    )
    change = ConversationMembershipChange(
        conversation_id=conversation_id,
        target_user_id=user_id,
        requested_by=auth.user.id,
        kind="add",
        status="pending",
    )
    db.add_all([membership, change])
    await db.flush()
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="conversation.e2ee_member_add_prepared",
            target_type="conversation",
            target_id=conversation.id,
        )
    )
    await db.commit()
    await db.refresh(change)
    return serialize_membership_change(change)


@router.post(
    "/conversations/{conversation_id}/membership-changes/remove/{user_id}",
    status_code=201,
)
async def prepare_membership_remove(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-member-remove-prepare", 30, 60)
    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        conversation is None
        or conversation.type != "group"
        or not conversation.encryption_required
        or not conversation.e2ee_ready
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted group not found")

    actor = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if actor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted group not found")

    target = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.e2ee_state == "active",
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(404, "Member not found")

    self_leave = user_id == auth.user.id
    if not self_leave and actor.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Group owner access required")
    if target.role == "owner":
        owner_count = await db.scalar(
            select(func.count())
            .select_from(ConversationMember)
            .where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.role == "owner",
                ConversationMember.e2ee_state != "pending_add",
            )
        )
        if int(owner_count or 0) <= 1:
            raise HTTPException(409, "Transfer ownership before removing the last owner")

    existing_change = (
        await db.execute(
            select(ConversationMembershipChange).where(
                ConversationMembershipChange.conversation_id == conversation_id,
                ConversationMembershipChange.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if existing_change is not None:
        if existing_change.kind == "remove" and existing_change.target_user_id == user_id:
            return serialize_membership_change(existing_change)
        raise HTTPException(status.HTTP_409_CONFLICT, "Another MLS membership transition is pending")

    target.e2ee_state = "pending_remove"
    change = ConversationMembershipChange(
        conversation_id=conversation_id,
        target_user_id=user_id,
        requested_by=auth.user.id,
        kind="remove",
        status="pending",
    )
    db.add(change)
    await db.flush()
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="conversation.e2ee_member_remove_prepared",
            target_type="conversation",
            target_id=conversation.id,
        )
    )
    await db.commit()
    await db.refresh(change)
    return serialize_membership_change(change)


@router.get("/conversations/{conversation_id}/membership-changes/pending")
async def pending_membership_change(
    conversation_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-change-pending", 120, 60)
    member = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")
    change = (
        await db.execute(
            select(ConversationMembershipChange).where(
                ConversationMembershipChange.conversation_id == conversation_id,
                ConversationMembershipChange.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if change is None:
        return {"change": None, "target_device": None}

    target_device = None
    if change.target_device_id is not None:
        device = (
            await db.execute(
                select(MlsDevice).where(
                    MlsDevice.user_id == change.target_user_id,
                    MlsDevice.device_id == change.target_device_id,
                )
            )
        ).scalar_one_or_none()
        if device is not None:
            target_device = {
                "device_id": str(device.device_id),
                "identity_public_key_b64": encode_bytes(device.identity_public_key),
                "active": await active_device(
                    db, device.user_id, device.device_id
                ) is not None,
            }
    return {
        "change": serialize_membership_change(change),
        "target_device": target_device,
    }


@router.post("/membership-changes/{change_id}/finalize", status_code=204)
async def finalize_membership_change(
    change_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-member-finalize", 30, 60)
    change = (
        await db.execute(
            select(ConversationMembershipChange)
            .where(ConversationMembershipChange.id == change_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if change is None:
        raise HTTPException(404, "MLS membership transition not found")
    if change.status == "completed":
        return
    if change.status != "pending":
        raise HTTPException(403, "MLS membership transition cannot be finalized")
    if change.kind not in {"device_add", "device_remove"} and change.requested_by != auth.user.id:
        raise HTTPException(403, "MLS membership transition cannot be finalized")

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == change.conversation_id)
            .with_for_update()
        )
    ).scalar_one()
    if not conversation.encryption_required or not conversation.e2ee_ready:
        raise HTTPException(409, "Encrypted conversation is not active")

    membership = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == change.conversation_id,
                ConversationMember.user_id == change.target_user_id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    pending_add_membership = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == change.conversation_id,
                ConversationMember.user_id == change.target_user_id,
            )
        )
    ).scalar_one_or_none()
    if change.kind not in {"add"} and membership is None:
        raise HTTPException(409, "Target membership no longer exists")

    if change.kind == "add":
        membership = pending_add_membership
        if membership is None:
            raise HTTPException(409, "Target membership no longer exists")
        if membership.e2ee_state != "pending_add":
            raise HTTPException(409, "Target is not pending MLS add")

        expected_welcomes = {
            pair
            for pair in await current_active_device_pairs(
                db, change.conversation_id, ("pending_add",)
            )
            if pair[0] == change.target_user_id
        }
        welcomed = await control_recipient_pairs_for_change(db, change.id, "welcome")
        if not expected_welcomes or not expected_welcomes.issubset(welcomed):
            raise HTTPException(409, "MLS add is missing Welcome delivery")

        expected_commits = await current_active_device_pairs(
            db, change.conversation_id, ("active",)
        )
        expected_commits.discard((auth.user.id, auth.session.id))
        committed = await control_recipient_pairs_for_change(db, change.id, "commit")
        if not expected_commits.issubset(committed):
            raise HTTPException(409, "MLS add is missing Commit delivery")

        membership.e2ee_state = "active"
        event_type = "conversation.members_added"
        payload = {
            "conversation_id": str(change.conversation_id),
            "user_ids": [str(change.target_user_id)],
        }
        extra = [change.target_user_id]
    elif change.kind == "remove":
        if membership.e2ee_state != "pending_remove":
            raise HTTPException(409, "Target is not pending MLS removal")

        expected_commits = await current_active_device_pairs(
            db, change.conversation_id, ("active", "pending_remove")
        )
        expected_commits.discard((auth.user.id, auth.session.id))
        committed = await control_recipient_pairs_for_change(db, change.id, "commit")
        if not expected_commits.issubset(committed):
            raise HTTPException(409, "MLS removal is missing Commit delivery")

        await db.delete(membership)
        event_type = "conversation.member_removed"
        payload = {
            "conversation_id": str(change.conversation_id),
            "user_id": str(change.target_user_id),
        }
        extra = [change.target_user_id]
    elif change.kind == "device_add":
        if change.target_device_id is None:
            raise HTTPException(409, "MLS device-add target is missing")
        device = await active_device(
            db, change.target_user_id, change.target_device_id
        )
        target_pair = (change.target_user_id, change.target_device_id)
        if device is not None:
            welcomed = await control_recipient_pairs_for_change(db, change.id, "welcome")
            if target_pair not in welcomed:
                raise HTTPException(409, "MLS device add is missing Welcome delivery")
            expected_commits = await current_active_device_pairs(
                db, change.conversation_id, ("active", "pending_remove")
            )
            expected_commits.discard((auth.user.id, auth.session.id))
            expected_commits.discard(target_pair)
            committed = await control_recipient_pairs_for_change(db, change.id, "commit")
            if not expected_commits.issubset(committed):
                raise HTTPException(409, "MLS device add is missing Commit delivery")
        event_type = "mls.device.rekeyed"
        payload = {
            "conversation_id": str(change.conversation_id),
            "user_id": str(change.target_user_id),
            "device_id": str(change.target_device_id),
            "kind": "device_add",
            "skipped": device is None,
        }
        extra = []
    elif change.kind == "device_remove":
        if change.target_device_id is None:
            raise HTTPException(409, "MLS device-remove target is missing")
        if await active_device(db, change.target_user_id, change.target_device_id) is not None:
            raise HTTPException(409, "MLS device-remove target is still active")
        expected_commits = await current_active_device_pairs(
            db, change.conversation_id, ("active", "pending_remove")
        )
        expected_commits.discard((auth.user.id, auth.session.id))
        committed = await control_recipient_pairs_for_change(db, change.id, "commit")
        if not expected_commits.issubset(committed):
            raise HTTPException(409, "MLS device removal is missing Commit delivery")
        commit_count = int(
            await db.scalar(
                select(func.count())
                .select_from(MlsControlEvent)
                .where(
                    MlsControlEvent.membership_change_id == change.id,
                    MlsControlEvent.kind == "commit",
                )
            )
            or 0
        )
        device_was_in_transport = bool(
            await db.scalar(
                select(
                    exists().where(
                        or_(
                            and_(
                                MlsControlEvent.conversation_id == change.conversation_id,
                                MlsControlEvent.sender_user_id == change.target_user_id,
                                MlsControlEvent.sender_device_id == change.target_device_id,
                            ),
                            exists().where(
                                MlsControlRecipient.event_id == MlsControlEvent.id,
                                MlsControlRecipient.user_id == change.target_user_id,
                                MlsControlRecipient.device_id == change.target_device_id,
                            ),
                        )
                    )
                )
            )
        )
        if commit_count < 1 and device_was_in_transport:
            raise HTTPException(409, "MLS device removal has no durable Remove commit")
        event_type = "mls.device.rekeyed"
        payload = {
            "conversation_id": str(change.conversation_id),
            "user_id": str(change.target_user_id),
            "device_id": str(change.target_device_id),
            "kind": "device_remove",
        }
        extra = []
    else:
        raise HTTPException(409, "Unsupported membership transition")

    change.status = "completed"
    change.completed_at = datetime.now(UTC)
    await promote_next_mls_change(db, change.conversation_id)
    db.add(
        OutboxEvent(
            event_type=event_type,
            aggregate_type="conversation",
            aggregate_id=change.conversation_id,
            conversation_id=change.conversation_id,
            payload={**payload, "_extra_recipient_ids": [str(item) for item in extra]},
        )
    )
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type=f"conversation.e2ee_member_{change.kind}_finalized",
            target_type="conversation",
            target_id=change.conversation_id,
        )
    )
    await db.commit()



@router.post("/conversations/{conversation_id}/activate", status_code=204)
async def activate_encrypted_conversation(
    conversation_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-conversation-activate", 30, 60)
    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        conversation is None
        or not conversation.encryption_required
        or conversation.created_by != auth.user.id
    ):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Pending encrypted conversation not found",
        )
    if conversation.e2ee_ready:
        return

    await require_active_device(db, auth.user.id, auth.session.id)
    now = datetime.now(UTC)
    expected_recipient_pairs = set(
        (
            await db.execute(
                select(MlsDevice.user_id, MlsDevice.device_id)
                .join(
                    ConversationMember,
                    ConversationMember.user_id == MlsDevice.user_id,
                )
                .join(
                    Session,
                    and_(
                        Session.id == MlsDevice.device_id,
                        Session.user_id == MlsDevice.user_id,
                    ),
                )
                .where(
                    ConversationMember.conversation_id == conversation_id,
                    MlsDevice.revoked_at.is_(None),
                    Session.revoked_at.is_(None),
                    Session.expires_at > now,
                )
            )
        ).all()
    )
    expected_recipient_pairs.discard((auth.user.id, auth.session.id))

    welcomed_pairs = set(
        (
            await db.execute(
                select(
                    MlsControlRecipient.user_id,
                    MlsControlRecipient.device_id,
                )
                .join(
                    MlsControlEvent,
                    MlsControlEvent.id == MlsControlRecipient.event_id,
                )
                .where(
                    MlsControlEvent.conversation_id == conversation_id,
                    MlsControlEvent.kind == "welcome",
                )
            )
        ).all()
    )
    missing_welcomes = expected_recipient_pairs - welcomed_pairs
    if missing_welcomes:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Encrypted conversation is missing Welcome delivery for active devices",
        )

    conversation.e2ee_ready = True
    db.add(
        OutboxEvent(
            event_type="conversation.created",
            aggregate_type="conversation",
            aggregate_id=conversation.id,
            conversation_id=conversation.id,
            payload={
                "conversation_id": str(conversation.id),
                "type": conversation.type,
                "title": conversation.title,
            },
        )
    )
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="conversation.e2ee_activated",
            target_type="conversation",
            target_id=conversation.id,
        )
    )
    await db.commit()


@router.put("/devices/{device_id}", status_code=204)
async def register_device(
    device_id: uuid.UUID,
    payload: DeviceRegistrationRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-device-register", 20, 3600)
    if device_id != auth.session.id:
        raise HTTPException(403, "MLS device id must match the current session")
    identity_key = decode_identity_key(payload.identity_public_key_b64)

    # Registration may be triggered concurrently by duplicate browser mounts
    # (for example React Strict Mode). Make the database write itself
    # idempotent instead of relying on a racy SELECT-then-INSERT sequence.
    inserted_id = (
        await db.execute(
            pg_insert(MlsDevice)
            .values(
                user_id=auth.user.id,
                device_id=device_id,
                identity_public_key=identity_key,
            )
            .on_conflict_do_nothing()
            .returning(MlsDevice.id)
        )
    ).scalar_one_or_none()

    if inserted_id is not None:
        await db.commit()
        return

    # A concurrent request or another unique key already won. Re-read the
    # authoritative row and accept only the exact same active device identity.
    existing = (
        await db.execute(
            select(MlsDevice).where(
                MlsDevice.user_id == auth.user.id,
                MlsDevice.device_id == device_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.revoked_at is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "MLS device is revoked")
        if existing.identity_public_key != identity_key:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "MLS device identity key change requires a new device id",
            )
        await db.commit()
        return

    raise HTTPException(
        status.HTTP_409_CONFLICT,
        "MLS identity key is already registered",
    )


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(
    device_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-device-revoke", 20, 3600)
    device = await require_active_device(db, auth.user.id, device_id)
    device.revoked_at = datetime.now(UTC)
    await schedule_mls_device_change(
        db, auth.user.id, device.device_id, "device_remove"
    )
    await db.execute(
        delete(MlsKeyPackage).where(
            MlsKeyPackage.user_id == auth.user.id,
            MlsKeyPackage.device_id == device_id,
            MlsKeyPackage.claimed_at.is_(None),
        )
    )
    await db.commit()


@router.put("/devices/{device_id}/key-packages", status_code=204)
async def publish_key_packages(
    device_id: uuid.UUID,
    payload: KeyPackagePublishRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-publish", 20, 3600)
    if payload.device_id != device_id:
        raise HTTPException(422, "Device ID mismatch")
    if device_id != auth.session.id:
        raise HTTPException(403, "MLS KeyPackages can only be published by the current device")
    device = await require_active_device(db, auth.user.id, device_id)
    had_any_key_package = int(
        await db.scalar(
            select(func.count())
            .select_from(MlsKeyPackage)
            .where(
                MlsKeyPackage.user_id == auth.user.id,
                MlsKeyPackage.device_id == device_id,
            )
        )
        or 0
    ) > 0

    decoded = [decode_key_package(item) for item in payload.key_packages_b64]
    refs = [hashlib.sha256(item).digest() for item in decoded]
    if len(set(refs)) != len(refs):
        raise HTTPException(422, "Duplicate KeyPackage in request")

    existing_rows = (
        await db.execute(
            select(MlsKeyPackage).where(MlsKeyPackage.package_ref.in_(refs))
        )
    ).scalars().all()
    existing_by_ref = {item.package_ref: item for item in existing_rows}

    for key_package, package_ref in zip(decoded, refs, strict=True):
        existing = existing_by_ref.get(package_ref)
        if existing is not None:
            if (
                existing.user_id != auth.user.id
                or existing.device_id != device_id
                or existing.key_package != key_package
            ):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "KeyPackage reference is already owned by another device",
                )
            # Idempotent retry. A consumed row remains consumed and is never
            # resurrected; an unclaimed row remains available exactly once.
            continue

        db.add(
            MlsKeyPackage(
                user_id=auth.user.id,
                device_id=device_id,
                package_ref=package_ref,
                key_package=key_package,
            )
        )
    if not had_any_key_package:
        await schedule_mls_device_change(
            db, auth.user.id, device.device_id, "device_add"
        )
    await db.commit()


@router.get("/users/{user_id}/devices")
async def list_key_package_devices(
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-list", 120, 60)
    now = datetime.now(UTC)
    rows = (
        await db.execute(
            select(MlsDevice, func.count(MlsKeyPackage.id))
            .join(
                Session,
                and_(
                    Session.id == MlsDevice.device_id,
                    Session.user_id == MlsDevice.user_id,
                ),
            )
            .outerjoin(
                MlsKeyPackage,
                (MlsKeyPackage.user_id == MlsDevice.user_id)
                & (MlsKeyPackage.device_id == MlsDevice.device_id)
                & (MlsKeyPackage.claimed_at.is_(None)),
            )
            .where(
                MlsDevice.user_id == user_id,
                MlsDevice.revoked_at.is_(None),
                Session.revoked_at.is_(None),
                Session.expires_at > now,
            )
            .group_by(MlsDevice.id)
            .order_by(MlsDevice.created_at, MlsDevice.device_id)
        )
    ).all()
    return [
        {
            "device_id": str(device.device_id),
            "identity_public_key_b64": encode_bytes(device.identity_public_key),
            "available_key_packages": int(count),
        }
        for device, count in rows
    ]


@router.post("/users/{user_id}/devices/{device_id}/key-package/claim")
async def claim_key_package(
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-claim", 120, 60)
    device = await active_device(db, user_id, device_id)
    if device is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "MLS device is unavailable")

    item = (
        await db.execute(
            select(MlsKeyPackage)
            .where(
                MlsKeyPackage.user_id == user_id,
                MlsKeyPackage.device_id == device_id,
                MlsKeyPackage.claimed_at.is_(None),
            )
            .order_by(MlsKeyPackage.created_at, MlsKeyPackage.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
    ).scalar_one_or_none()

    if item is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "No MLS KeyPackage available",
        )

    item.claimed_at = datetime.now(UTC)
    await db.flush()
    response = {
        "user_id": str(item.user_id),
        "device_id": str(item.device_id),
        "identity_public_key_b64": encode_bytes(device.identity_public_key),
        "package_ref": item.package_ref.hex(),
        "key_package_b64": encode_bytes(item.key_package),
    }
    await db.commit()
    return response


@router.delete("/devices/{device_id}/key-packages", status_code=204)
async def discard_unclaimed_key_packages(
    device_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-discard", 20, 3600)
    if device_id != auth.session.id:
        raise HTTPException(403, "MLS KeyPackages can only be discarded by the current device")
    await require_active_device(db, auth.user.id, device_id)
    await db.execute(
        delete(MlsKeyPackage).where(
            MlsKeyPackage.user_id == auth.user.id,
            MlsKeyPackage.device_id == device_id,
            MlsKeyPackage.claimed_at.is_(None),
        )
    )
    await db.commit()


@router.post("/conversations/{conversation_id}/control-events", status_code=201)
async def create_control_event(
    conversation_id: uuid.UUID,
    payload: ControlEventCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-create", 120, 60)
    if payload.sender_device_id != auth.session.id:
        raise HTTPException(403, "MLS control sender must be the current device")
    await require_active_device(db, auth.user.id, payload.sender_device_id)
    control_bytes = decode_control_payload(payload.payload_b64)

    recipient_pairs = {(item.user_id, item.device_id) for item in payload.recipients}
    if len(recipient_pairs) != len(payload.recipients):
        raise HTTPException(422, "Duplicate MLS control recipient")

    existing = (
        await db.execute(
            select(MlsControlEvent).where(
                MlsControlEvent.sender_user_id == auth.user.id,
                MlsControlEvent.sender_device_id == payload.sender_device_id,
                MlsControlEvent.client_id == payload.client_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing_recipients = set(
            (
                await db.execute(
                    select(
                        MlsControlRecipient.user_id,
                        MlsControlRecipient.device_id,
                    ).where(MlsControlRecipient.event_id == existing.id)
                )
            ).all()
        )
        if (
            existing.conversation_id != conversation_id
            or existing.kind != payload.kind
            or existing.payload != control_bytes
            or existing_recipients != recipient_pairs
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "MLS control client id was reused with different content",
            )
        return serialize_control_event(existing)

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if conversation is None or not conversation.encryption_required:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")

    sender_member = (
        await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if sender_member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")

    recipient_user_ids = {user_id for user_id, _ in recipient_pairs}
    member_user_ids = set(
        (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id.in_(recipient_user_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if member_user_ids != recipient_user_ids:
        raise HTTPException(422, "MLS control recipient is not a conversation member")

    active_pairs = set(
        (
            await db.execute(
                select(MlsDevice.user_id, MlsDevice.device_id).where(
                    tuple_(MlsDevice.user_id, MlsDevice.device_id).in_(list(recipient_pairs)),
                    MlsDevice.revoked_at.is_(None),
                )
            )
        ).all()
    )
    if active_pairs != recipient_pairs:
        raise HTTPException(422, "MLS control recipient device is unavailable")

    sequence = conversation.next_crypto_sequence
    conversation.next_crypto_sequence += 1
    item = MlsControlEvent(
        conversation_id=conversation_id,
        sender_user_id=auth.user.id,
        sender_device_id=payload.sender_device_id,
        client_id=payload.client_id,
        sequence=sequence,
        kind=payload.kind,
        payload=control_bytes,
    )
    db.add(item)
    await db.flush()

    transport_sequence = conversation.next_transport_sequence
    conversation.next_transport_sequence += 1
    db.add(
        ConversationTransportEvent(
            conversation_id=conversation_id,
            sequence=transport_sequence,
            kind="mls_control",
            control_event_id=item.id,
        )
    )

    for user_id, device_id in sorted(recipient_pairs, key=lambda pair: (str(pair[0]), str(pair[1]))):
        db.add(
            MlsControlRecipient(
                event_id=item.id,
                user_id=user_id,
                device_id=device_id,
            )
        )

    db.add(
        OutboxEvent(
            event_type="mls.control.created",
            aggregate_type="mls_control",
            aggregate_id=item.id,
            conversation_id=conversation_id,
            payload={
                "control_event_id": str(item.id),
                "kind": item.kind,
                "sequence": item.sequence,
                "_extra_recipient_ids": [str(user_id) for user_id in sorted(recipient_user_ids, key=str)],
            },
        )
    )
    await db.commit()
    await db.refresh(item)
    return serialize_control_event(item)


@router.post("/conversations/{conversation_id}/control-batches", status_code=201)
async def create_control_batch(
    conversation_id: uuid.UUID,
    payload: ControlEventBatchCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-batch-create", 60, 60)
    if payload.sender_device_id != auth.session.id:
        raise HTTPException(403, "MLS control sender must be the current device")
    await require_active_device(db, auth.user.id, payload.sender_device_id)

    client_ids = [item.client_id for item in payload.events]
    if len(set(client_ids)) != len(client_ids):
        raise HTTPException(422, "Duplicate MLS control client id in batch")

    decoded: list[tuple[ControlEventBatchItemRequest, bytes, set[tuple[uuid.UUID, uuid.UUID]]]] = []
    for request_item in payload.events:
        control_bytes = decode_control_payload(request_item.payload_b64)
        recipient_pairs = {
            (recipient.user_id, recipient.device_id)
            for recipient in request_item.recipients
        }
        if len(recipient_pairs) != len(request_item.recipients):
            raise HTTPException(422, "Duplicate MLS control recipient")
        decoded.append((request_item, control_bytes, recipient_pairs))

    existing_rows = (
        await db.execute(
            select(MlsControlEvent).where(
                MlsControlEvent.sender_user_id == auth.user.id,
                MlsControlEvent.sender_device_id == payload.sender_device_id,
                MlsControlEvent.client_id.in_(client_ids),
            )
        )
    ).scalars().all()
    existing_by_client = {item.client_id: item for item in existing_rows}

    if existing_by_client:
        if len(existing_by_client) != len(payload.events):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Partial MLS control batch client-id collision",
            )

        recipient_rows = (
            await db.execute(
                select(
                    MlsControlRecipient.event_id,
                    MlsControlRecipient.user_id,
                    MlsControlRecipient.device_id,
                ).where(
                    MlsControlRecipient.event_id.in_(
                        [item.id for item in existing_rows]
                    )
                )
            )
        ).all()
        recipients_by_event: dict[uuid.UUID, set[tuple[uuid.UUID, uuid.UUID]]] = {}
        for event_id, user_id, device_id in recipient_rows:
            recipients_by_event.setdefault(event_id, set()).add((user_id, device_id))

        ordered_existing: list[MlsControlEvent] = []
        for request_item, control_bytes, recipient_pairs in decoded:
            existing = existing_by_client[request_item.client_id]
            if (
                existing.conversation_id != conversation_id
                or existing.kind != request_item.kind
                or existing.payload != control_bytes
                or recipients_by_event.get(existing.id, set()) != recipient_pairs
            ):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "MLS control batch retry differs from stored content",
                )
            ordered_existing.append(existing)

        return {"events": [serialize_control_event(item) for item in ordered_existing]}

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if conversation is None or not conversation.encryption_required:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")

    sender_member = (
        await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if sender_member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")

    pending_change = (
        await db.execute(
            select(ConversationMembershipChange).where(
                ConversationMembershipChange.conversation_id == conversation_id,
                ConversationMembershipChange.status == "pending",
            )
        )
    ).scalar_one_or_none()
    if pending_change is not None:
        if payload.membership_change_id != pending_change.id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "MLS membership transition id is required for this control batch",
            )
        if (
            pending_change.kind not in {"device_add", "device_remove"}
            and pending_change.requested_by != auth.user.id
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Membership transition owner mismatch")
        existing_transition_sender = (
            await db.execute(
                select(
                    MlsControlEvent.sender_user_id,
                    MlsControlEvent.sender_device_id,
                )
                .where(MlsControlEvent.membership_change_id == pending_change.id)
                .order_by(MlsControlEvent.created_at, MlsControlEvent.id)
                .limit(1)
            )
        ).first()
        if (
            existing_transition_sender is not None
            and existing_transition_sender
            != (auth.user.id, payload.sender_device_id)
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "MLS membership transition is already owned by another device",
            )
    elif payload.membership_change_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Membership transition is no longer pending")

    all_recipient_pairs = set().union(
        *(recipient_pairs for _, _, recipient_pairs in decoded)
    )
    all_recipient_user_ids = {
        user_id for user_id, _ in all_recipient_pairs
    }

    member_user_ids = set(
        (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id.in_(all_recipient_user_ids),
                )
            )
        ).scalars().all()
    )
    if member_user_ids != all_recipient_user_ids:
        raise HTTPException(422, "MLS control recipient is not a conversation member")

    active_pairs = set(
        (
            await db.execute(
                select(MlsDevice.user_id, MlsDevice.device_id).where(
                    tuple_(MlsDevice.user_id, MlsDevice.device_id).in_(
                        list(all_recipient_pairs)
                    ),
                    MlsDevice.revoked_at.is_(None),
                )
            )
        ).all()
    )
    if active_pairs != all_recipient_pairs:
        raise HTTPException(422, "MLS control recipient device is unavailable")

    created: list[MlsControlEvent] = []
    for request_item, control_bytes, recipient_pairs in decoded:
        sequence = conversation.next_crypto_sequence
        conversation.next_crypto_sequence += 1
        item = MlsControlEvent(
            conversation_id=conversation_id,
            sender_user_id=auth.user.id,
            sender_device_id=payload.sender_device_id,
            client_id=request_item.client_id,
            sequence=sequence,
            kind=request_item.kind,
            payload=control_bytes,
            membership_change_id=payload.membership_change_id,
        )
        db.add(item)
        await db.flush()
        transport_sequence = conversation.next_transport_sequence
        conversation.next_transport_sequence += 1
        db.add(
            ConversationTransportEvent(
                conversation_id=conversation_id,
                sequence=transport_sequence,
                kind="mls_control",
                control_event_id=item.id,
            )
        )

        for user_id, device_id in sorted(
            recipient_pairs,
            key=lambda pair: (str(pair[0]), str(pair[1])),
        ):
            db.add(
                MlsControlRecipient(
                    event_id=item.id,
                    user_id=user_id,
                    device_id=device_id,
                )
            )

        recipient_user_ids = {user_id for user_id, _ in recipient_pairs}
        db.add(
            OutboxEvent(
                event_type="mls.control.created",
                aggregate_type="mls_control",
                aggregate_id=item.id,
                conversation_id=conversation_id,
                payload={
                    "control_event_id": str(item.id),
                    "kind": item.kind,
                    "sequence": item.sequence,
                    "_extra_recipient_ids": [
                        str(user_id)
                        for user_id in sorted(recipient_user_ids, key=str)
                    ],
                },
            )
        )
        created.append(item)

    await db.commit()
    for item in created:
        await db.refresh(item)
    return {"events": [serialize_control_event(item) for item in created]}




@router.get("/conversations/{conversation_id}/devices/{device_id}/transport-events")
async def list_transport_events(
    conversation_id: uuid.UUID,
    device_id: uuid.UUID,
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-transport-list", 240, 60)
    if device_id != auth.session.id:
        raise HTTPException(403, "MLS feed can only be fetched by the current device")
    await require_active_device(db, auth.user.id, device_id)

    conversation = (
        await db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
    ).scalar_one_or_none()
    if conversation is None or not conversation.encryption_required:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Encrypted conversation not found",
        )

    is_member = (
        await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none() is not None

    control_assigned = exists(
        select(MlsControlRecipient.event_id).where(
            MlsControlRecipient.event_id == ConversationTransportEvent.control_event_id,
            MlsControlRecipient.user_id == auth.user.id,
            MlsControlRecipient.device_id == device_id,
        )
    )
    visibility = and_(
        ConversationTransportEvent.kind == "mls_control",
        control_assigned,
    )
    if is_member:
        visibility = or_(
            ConversationTransportEvent.kind == "message",
            visibility,
        )

    rows = (
        await db.execute(
            select(ConversationTransportEvent)
            .where(
                ConversationTransportEvent.conversation_id == conversation_id,
                ConversationTransportEvent.sequence > after,
                visibility,
            )
            .order_by(ConversationTransportEvent.sequence)
            .limit(limit)
        )
    ).scalars().all()

    output: list[dict] = []
    for row in rows:
        if row.kind == "message" and row.message_id is not None:
            message = (
                await db.execute(select(Message).where(Message.id == row.message_id))
            ).scalar_one_or_none()
            if message is None:
                continue
            output.append(
                {
                    "transport_sequence": row.sequence,
                    "kind": "message",
                    "message_id": str(message.id),
                    "sender_user_id": str(message.sender_id),
                    "message_sequence": message.sequence,
                    "envelope": message.envelope,
                }
            )
            continue

        if row.kind == "mls_control" and row.control_event_id is not None:
            control = (
                await db.execute(
                    select(MlsControlEvent).where(
                        MlsControlEvent.id == row.control_event_id
                    )
                )
            ).scalar_one_or_none()
            if control is None:
                continue
            output.append(
                {
                    "transport_sequence": row.sequence,
                    "kind": "mls_control",
                    "control": serialize_control_event(control),
                }
            )

    return output


@router.get("/conversations/{conversation_id}/devices/{device_id}/control-events")
async def list_control_events(
    conversation_id: uuid.UUID,
    device_id: uuid.UUID,
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-list", 240, 60)
    if device_id != auth.session.id:
        raise HTTPException(403, "MLS feed can only be fetched by the current device")
    await require_active_device(db, auth.user.id, device_id)

    rows = (
        await db.execute(
            select(MlsControlEvent)
            .join(
                MlsControlRecipient,
                MlsControlRecipient.event_id == MlsControlEvent.id,
            )
            .where(
                MlsControlEvent.conversation_id == conversation_id,
                MlsControlRecipient.user_id == auth.user.id,
                MlsControlRecipient.device_id == device_id,
                MlsControlRecipient.acked_at.is_(None),
                MlsControlEvent.sequence > after,
            )
            .order_by(MlsControlEvent.sequence)
            .limit(limit)
        )
    ).scalars().all()
    return [serialize_control_event(item) for item in rows]


@router.get("/control-events/{event_id}/sender-identity")
async def control_event_sender_identity(
    event_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-sender-identity", 240, 60)
    await require_active_device(db, auth.user.id, auth.session.id)
    event = (
        await db.execute(
            select(MlsControlEvent)
            .join(
                MlsControlRecipient,
                MlsControlRecipient.event_id == MlsControlEvent.id,
            )
            .where(
                MlsControlEvent.id == event_id,
                MlsControlRecipient.user_id == auth.user.id,
                MlsControlRecipient.device_id == auth.session.id,
            )
        )
    ).scalar_one_or_none()
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MLS control event not found")

    device = (
        await db.execute(
            select(MlsDevice).where(
                MlsDevice.user_id == event.sender_user_id,
                MlsDevice.device_id == event.sender_device_id,
            )
        )
    ).scalar_one_or_none()
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MLS sender identity not found")
    return {
        "user_id": str(event.sender_user_id),
        "device_id": str(event.sender_device_id),
        "identity_public_key_b64": encode_bytes(device.identity_public_key),
    }


@router.post("/control-events/{event_id}/ack", status_code=204)
async def ack_control_event(
    event_id: uuid.UUID,
    payload: ControlEventAckRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-ack", 240, 60)
    if payload.device_id != auth.session.id:
        raise HTTPException(403, "MLS control event can only be acknowledged by the current device")
    await require_active_device(db, auth.user.id, payload.device_id)
    recipient = (
        await db.execute(
            select(MlsControlRecipient)
            .where(
                MlsControlRecipient.event_id == event_id,
                MlsControlRecipient.user_id == auth.user.id,
                MlsControlRecipient.device_id == payload.device_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if recipient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MLS control event not found")
    if recipient.acked_at is None:
        recipient.acked_at = datetime.now(UTC)
        await db.commit()
