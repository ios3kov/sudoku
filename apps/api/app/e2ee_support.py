import base64
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Conversation,
    ConversationMember,
    ConversationMembershipChange,
    MlsControlEvent,
    MlsControlRecipient,
    MlsDevice,
    Session,
)

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
    recipients: list[ControlRecipientRequest] = Field(default_factory=list, max_length=200)


class ControlEventBatchCreateRequest(BaseModel):
    sender_device_id: uuid.UUID
    membership_change_id: uuid.UUID | None = None
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
    now = datetime.now(UTC)
    return (
        await db.execute(
            select(MlsDevice)
            .join(
                Session,
                and_(
                    Session.id == MlsDevice.device_id,
                    Session.user_id == MlsDevice.user_id,
                ),
            )
            .where(
                MlsDevice.user_id == user_id,
                MlsDevice.device_id == device_id,
                MlsDevice.revoked_at.is_(None),
                Session.revoked_at.is_(None),
                Session.expires_at > now,
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
        "membership_change_id": str(item.membership_change_id) if item.membership_change_id else None,
        "payload_b64": encode_bytes(item.payload),
        "created_at": item.created_at.isoformat(),
    }


def serialize_membership_change(item: ConversationMembershipChange) -> dict:
    return {
        "id": str(item.id),
        "conversation_id": str(item.conversation_id),
        "target_user_id": str(item.target_user_id),
        "target_device_id": str(item.target_device_id) if item.target_device_id else None,
        "requested_by": str(item.requested_by),
        "kind": item.kind,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
    }


async def require_e2ee_group_owner(
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
    if (
        conversation is None
        or conversation.type != "group"
        or not conversation.encryption_required
        or not conversation.e2ee_ready
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Encrypted group not found")
    membership = (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    ).scalar_one_or_none()
    if membership is None or membership.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Group owner access required")
    return conversation, membership


async def current_active_device_pairs(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    states: tuple[str, ...],
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    now = datetime.now(UTC)
    return set(
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
                    ConversationMember.e2ee_state.in_(states),
                    MlsDevice.revoked_at.is_(None),
                    Session.revoked_at.is_(None),
                    Session.expires_at > now,
                )
            )
        ).all()
    )


async def control_recipient_pairs_for_change(
    db: AsyncSession,
    change_id: uuid.UUID,
    kind: str,
) -> set[tuple[uuid.UUID, uuid.UUID]]:
    return set(
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
                    MlsControlEvent.membership_change_id == change_id,
                    MlsControlEvent.kind == kind,
                )
            )
        ).all()
    )
