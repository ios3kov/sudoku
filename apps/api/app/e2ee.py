import base64
import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .deps import AuthContext, get_auth_context
from .models import (
    Conversation,
    ConversationMember,
    ConversationTransportEvent,
    MlsControlEvent,
    MlsControlRecipient,
    MlsDevice,
    Message,
    MlsKeyPackage,
    OutboxEvent,
)
from .rate_limit import enforce_user_rate_limit

router = APIRouter(prefix="/v1/e2ee", tags=["e2ee"])

MAX_KEY_PACKAGE_BYTES = 64 * 1024
MAX_CONTROL_EVENT_BYTES = 1024 * 1024
IDENTITY_PUBLIC_KEY_BYTES = 32


class DeviceRegistrationRequest(BaseModel):
    identity_public_key_b64: str = Field(min_length=1, max_length=256)


class KeyPackagePublishRequest(BaseModel):
    device_id: uuid.UUID
    key_packages_b64: list[str] = Field(min_length=1, max_length=100)


class ControlRecipientRequest(BaseModel):
    user_id: uuid.UUID
    device_id: uuid.UUID


class ControlEventCreateRequest(BaseModel):
    client_id: uuid.UUID
    sender_device_id: uuid.UUID
    kind: str = Field(pattern="^(commit|welcome)$")
    payload_b64: str = Field(min_length=1, max_length=2 * MAX_CONTROL_EVENT_BYTES)
    recipients: list[ControlRecipientRequest] = Field(min_length=1, max_length=200)


class ControlEventBatchItemRequest(BaseModel):
    client_id: uuid.UUID
    kind: str = Field(pattern="^(commit|welcome)$")
    payload_b64: str = Field(min_length=1, max_length=2 * MAX_CONTROL_EVENT_BYTES)
    recipients: list[ControlRecipientRequest] = Field(min_length=1, max_length=200)


class ControlEventBatchCreateRequest(BaseModel):
    sender_device_id: uuid.UUID
    events: list[ControlEventBatchItemRequest] = Field(min_length=1, max_length=10)


class ControlEventAckRequest(BaseModel):
    device_id: uuid.UUID


def decode_key_package(value: str) -> bytes:
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(422, "Invalid base64 KeyPackage") from exc
    if not decoded or len(decoded) > MAX_KEY_PACKAGE_BYTES:
        raise HTTPException(422, "Invalid KeyPackage size")
    return decoded


def decode_identity_key(value: str) -> bytes:
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(422, "Invalid base64 MLS identity key") from exc
    if len(decoded) != IDENTITY_PUBLIC_KEY_BYTES:
        raise HTTPException(422, "MLS identity key must be 32 bytes")
    return decoded


def decode_control_payload(value: str) -> bytes:
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(422, "Invalid base64 MLS control payload") from exc
    if not decoded or len(decoded) > MAX_CONTROL_EVENT_BYTES:
        raise HTTPException(422, "Invalid MLS control payload size")
    return decoded


def encode_bytes(value: bytes) -> str:
    return base64.b64encode(value).decode()


async def active_device(
    db: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
) -> MlsDevice | None:
    return (
        await db.execute(
            select(MlsDevice).where(
                MlsDevice.user_id == user_id,
                MlsDevice.device_id == device_id,
                MlsDevice.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def require_active_device(
    db: AsyncSession,
    user_id: uuid.UUID,
    device_id: uuid.UUID,
) -> MlsDevice:
    device = await active_device(db, user_id, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MLS device not found")
    return device


def serialize_control_event(item: MlsControlEvent) -> dict:
    return {
        "id": str(item.id),
        "conversation_id": str(item.conversation_id),
        "sender_user_id": str(item.sender_user_id),
        "sender_device_id": str(item.sender_device_id),
        "client_id": str(item.client_id),
        "sequence": item.sequence,
        "kind": item.kind,
        "payload_b64": encode_bytes(item.payload),
        "created_at": item.created_at.isoformat(),
    }


@router.put("/devices/{device_id}", status_code=204)
async def register_device(
    device_id: uuid.UUID,
    payload: DeviceRegistrationRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-device-register", 20, 3600)
    identity_key = decode_identity_key(payload.identity_public_key_b64)

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
        return

    key_owner = (
        await db.execute(
            select(MlsDevice).where(MlsDevice.identity_public_key == identity_key)
        )
    ).scalar_one_or_none()
    if key_owner is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "MLS identity key is already registered",
        )

    db.add(
        MlsDevice(
            user_id=auth.user.id,
            device_id=device_id,
            identity_public_key=identity_key,
        )
    )
    await db.commit()


@router.delete("/devices/{device_id}", status_code=204)
async def revoke_device(
    device_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-device-revoke", 20, 3600)
    device = await require_active_device(db, auth.user.id, device_id)
    device.revoked_at = datetime.now(UTC)
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
    await require_active_device(db, auth.user.id, device_id)

    decoded = [decode_key_package(item) for item in payload.key_packages_b64]
    refs = [hashlib.sha256(item).digest() for item in decoded]
    if len(set(refs)) != len(refs):
        raise HTTPException(422, "Duplicate KeyPackage in request")

    existing_refs = set(
        (
            await db.execute(
                select(MlsKeyPackage.package_ref).where(MlsKeyPackage.package_ref.in_(refs))
            )
        )
        .scalars()
        .all()
    )
    if existing_refs:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "KeyPackage has already been registered or consumed",
        )

    for key_package, package_ref in zip(decoded, refs, strict=True):
        db.add(
            MlsKeyPackage(
                user_id=auth.user.id,
                device_id=device_id,
                package_ref=package_ref,
                key_package=key_package,
            )
        )
    await db.commit()


@router.get("/users/{user_id}/devices")
async def list_key_package_devices(
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-list", 120, 60)
    rows = (
        await db.execute(
            select(MlsDevice, func.count(MlsKeyPackage.id))
            .outerjoin(
                MlsKeyPackage,
                (MlsKeyPackage.user_id == MlsDevice.user_id)
                & (MlsKeyPackage.device_id == MlsDevice.device_id)
                & (MlsKeyPackage.claimed_at.is_(None)),
            )
            .where(
                MlsDevice.user_id == user_id,
                MlsDevice.revoked_at.is_(None),
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
            )
        )
    ).scalar_one_or_none()
    if sender_member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted conversation not found")

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
    await require_active_device(db, auth.user.id, device_id)

    is_member = (
        await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == auth.user.id,
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


@router.post("/control-events/{event_id}/ack", status_code=204)
async def ack_control_event(
    event_id: uuid.UUID,
    payload: ControlEventAckRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-control-ack", 240, 60)
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
