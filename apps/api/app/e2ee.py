import base64
import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .deps import AuthContext, get_auth_context
from .models import MlsKeyPackage
from .rate_limit import enforce_user_rate_limit

router = APIRouter(prefix="/v1/e2ee", tags=["e2ee"])

MAX_KEY_PACKAGE_BYTES = 64 * 1024


class KeyPackagePublishRequest(BaseModel):
    device_id: uuid.UUID
    key_packages_b64: list[str] = Field(min_length=1, max_length=100)


def decode_key_package(value: str) -> bytes:
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(422, "Invalid base64 KeyPackage") from exc
    if not decoded or len(decoded) > MAX_KEY_PACKAGE_BYTES:
        raise HTTPException(422, "Invalid KeyPackage size")
    return decoded


def encode_bytes(value: bytes) -> str:
    return base64.b64encode(value).decode()


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
            select(MlsKeyPackage.device_id, func.count(MlsKeyPackage.id))
            .where(
                MlsKeyPackage.user_id == user_id,
                MlsKeyPackage.claimed_at.is_(None),
            )
            .group_by(MlsKeyPackage.device_id)
            .order_by(MlsKeyPackage.device_id)
        )
    ).all()
    return [
        {"device_id": str(device_id), "available_key_packages": int(count)}
        for device_id, count in rows
    ]


@router.post("/users/{user_id}/devices/{device_id}/key-package/claim")
async def claim_key_package(
    user_id: uuid.UUID,
    device_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "mls-key-package-claim", 120, 60)

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
        "device_id": str(item.device_id),
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
    await db.execute(
        delete(MlsKeyPackage).where(
            MlsKeyPackage.user_id == auth.user.id,
            MlsKeyPackage.device_id == device_id,
            MlsKeyPackage.claimed_at.is_(None),
        )
    )
    await db.commit()
