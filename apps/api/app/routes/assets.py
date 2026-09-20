import hashlib
import re
import uuid
from datetime import UTC, datetime

import anyio
import filetype
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import AuthContext, get_auth_context
from ..metrics import record_asset_rejected, record_asset_verified
from ..models import Asset, ConversationMember, Message, MessageAsset
from ..rate_limit import enforce_user_rate_limit
from ..schemas import AssetResponse, E2eeUploadIntentRequest, UploadIntentRequest, UploadIntentResponse
from ..storage import s3_client, s3_presign_client

router = APIRouter(prefix="/v1/assets", tags=["assets"])
settings = get_settings()
UPLOAD_TTL_SECONDS = 10 * 60
DOWNLOAD_TTL_SECONDS = 5 * 60
E2EE_CIPHERTEXT_MIME = "application/octet-stream"
E2EE_CIPHERTEXT_FILENAME = "encrypted.bin"
ALLOWED_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
    "audio/mpeg",
    "audio/mp4",
    "audio/webm",
    "video/mp4",
    "video/webm",
}


def _safe_filename(filename: str) -> str:
    name = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name)
    return name[:255] or "file"


def _validate_mime(mime_type: str) -> None:
    if mime_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="File type is not allowed")


async def _can_access_asset(db: AsyncSession, asset: Asset, user_id: uuid.UUID) -> bool:
    if asset.owner_id == user_id:
        return True
    permitted = await db.scalar(
        select(
            exists().where(
                MessageAsset.asset_id == asset.id,
                Message.id == MessageAsset.message_id,
                ConversationMember.conversation_id == Message.conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.e2ee_state != "pending_add",
            )
        )
    )
    return bool(permitted)


@router.post("/upload-intents", response_model=UploadIntentResponse, status_code=201)
async def create_upload_intent(
    payload: UploadIntentRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "asset-upload-intent", 30, 60)
    _validate_mime(payload.mime_type)
    asset_id = uuid.uuid4()
    filename = _safe_filename(payload.filename)
    storage_key = f"users/{auth.user.id}/assets/{asset_id}/original"
    sha256_bytes = bytes.fromhex(payload.sha256_hex.lower())
    asset = Asset(
        id=asset_id,
        owner_id=auth.user.id,
        storage_key=storage_key,
        filename=filename,
        mime_type=payload.mime_type,
        size_bytes=payload.size_bytes,
        sha256=sha256_bytes,
        status="pending",
    )
    db.add(asset)
    await db.commit()

    params = {
        "Bucket": settings.s3_bucket,
        "Key": storage_key,
        "ContentType": payload.mime_type,
        "Metadata": {"sha256": payload.sha256_hex.lower()},
    }
    upload_url = s3_presign_client().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=UPLOAD_TTL_SECONDS,
        HttpMethod="PUT",
    )
    return UploadIntentResponse(
        asset_id=asset_id,
        upload_url=upload_url,
        headers={
            "Content-Type": payload.mime_type,
            "x-amz-meta-sha256": payload.sha256_hex.lower(),
        },
        expires_in=UPLOAD_TTL_SECONDS,
    )


@router.post("/e2ee-upload-intents", response_model=UploadIntentResponse, status_code=201)
async def create_e2ee_upload_intent(
    payload: E2eeUploadIntentRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "e2ee-asset-upload-intent", 30, 60)
    asset_id = uuid.uuid4()
    storage_key = f"users/{auth.user.id}/assets/{asset_id}/ciphertext"
    digest = payload.sha256_hex.lower()
    asset = Asset(
        id=asset_id,
        owner_id=auth.user.id,
        storage_key=storage_key,
        filename=E2EE_CIPHERTEXT_FILENAME,
        mime_type=E2EE_CIPHERTEXT_MIME,
        size_bytes=payload.size_bytes,
        sha256=bytes.fromhex(digest),
        e2ee_ciphertext=True,
        status="pending",
    )
    db.add(asset)
    await db.commit()

    params = {
        "Bucket": settings.s3_bucket,
        "Key": storage_key,
        "ContentType": E2EE_CIPHERTEXT_MIME,
        "Metadata": {"sha256": digest, "e2ee": "1"},
    }
    upload_url = s3_presign_client().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=UPLOAD_TTL_SECONDS,
        HttpMethod="PUT",
    )
    return UploadIntentResponse(
        asset_id=asset_id,
        upload_url=upload_url,
        headers={
            "Content-Type": E2EE_CIPHERTEXT_MIME,
            "x-amz-meta-sha256": digest,
            "x-amz-meta-e2ee": "1",
        },
        expires_in=UPLOAD_TTL_SECONDS,
    )


@router.post("/{asset_id}/complete", response_model=AssetResponse)
async def complete_upload(
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "asset-complete", 60, 60)
    asset = (
        await db.execute(select(Asset).where(Asset.id == asset_id, Asset.owner_id == auth.user.id))
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset.status == "ready":
        return _asset_response(asset)

    def verify_object():
        head = s3_client().head_object(Bucket=settings.s3_bucket, Key=asset.storage_key)
        if int(head.get("ContentLength", -1)) != asset.size_bytes:
            raise ValueError("size")
        if str(head.get("ContentType", "")) != asset.mime_type:
            raise ValueError("content-type")

        response = s3_client().get_object(Bucket=settings.s3_bucket, Key=asset.storage_key)
        digest = hashlib.sha256()
        prefix = bytearray()
        total = 0
        body = response["Body"]
        try:
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                digest.update(chunk)
                if len(prefix) < 4096:
                    prefix.extend(chunk[: 4096 - len(prefix)])
        finally:
            body.close()
        if total != asset.size_bytes or digest.digest() != asset.sha256:
            raise ValueError("digest")

        if asset.e2ee_ciphertext:
            if asset.mime_type != E2EE_CIPHERTEXT_MIME:
                raise ValueError("e2ee-content-type")
        elif asset.mime_type == "text/plain":
            bytes(prefix).decode("utf-8")
        else:
            guessed = filetype.guess(bytes(prefix))
            if guessed is None or guessed.mime != asset.mime_type:
                # Browsers commonly report audio/mp4/video/mp4 while signature detection returns video/mp4.
                equivalent_container = (
                    guessed is not None
                    and (
                        (asset.mime_type == "audio/mp4" and guessed.mime == "video/mp4")
                        or (asset.mime_type == "audio/webm" and guessed.mime == "video/webm")
                    )
                )
                if not equivalent_container:
                    raise ValueError("mime-signature")
        return True

    try:
        await anyio.to_thread.run_sync(verify_object)
    except Exception as exc:
        asset.status = "rejected"
        record_asset_rejected("integrity_or_type")
        await db.commit()

        # Rejected bytes are not useful and may be hostile. Best-effort delete now;
        # the periodic orphan cleanup retries later if the object store is unavailable.
        def delete_rejected_object() -> None:
            s3_client().delete_object(Bucket=settings.s3_bucket, Key=asset.storage_key)

        try:
            await anyio.to_thread.run_sync(delete_rejected_object)
        except Exception:
            pass
        raise HTTPException(status_code=409, detail="Uploaded file failed integrity/type verification") from exc

    asset.status = "ready"
    record_asset_verified("encrypted" if asset.e2ee_ciphertext else asset.mime_type.split("/", 1)[0])
    asset.ready_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(asset)
    return _asset_response(asset)


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    asset = (await db.execute(select(Asset).where(Asset.id == asset_id))).scalar_one_or_none()
    if asset is None or asset.status != "ready" or not await _can_access_asset(db, asset, auth.user.id):
        raise HTTPException(status_code=404, detail="Asset not found")
    return _asset_response(asset)


@router.get("/{asset_id}/content", response_class=RedirectResponse)
async def asset_content(
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    asset = (await db.execute(select(Asset).where(Asset.id == asset_id))).scalar_one_or_none()
    if asset is None or asset.status != "ready" or not await _can_access_asset(db, asset, auth.user.id):
        raise HTTPException(status_code=404, detail="Asset not found")
    disposition = (
        "attachment"
        if asset.e2ee_ciphertext
        else ("inline" if asset.mime_type.startswith(("image/", "video/", "audio/")) else "attachment")
    )
    url = s3_presign_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": asset.storage_key,
            "ResponseContentDisposition": f'{disposition}; filename="{asset.filename.replace(chr(34), "")}"',
            "ResponseCacheControl": "private, no-store, max-age=0",
        },
        ExpiresIn=DOWNLOAD_TTL_SECONDS,
    )
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


def _asset_response(asset: Asset) -> AssetResponse:
    return AssetResponse(
        id=asset.id,
        mime_type=asset.mime_type,
        size_bytes=asset.size_bytes,
        filename=asset.filename,
        e2ee_ciphertext=asset.e2ee_ciphertext,
        status=asset.status,
        content_url=f"/v1/assets/{asset.id}/content",
        sha256_hex=asset.sha256.hex(),
        created_at=asset.created_at,
    )
