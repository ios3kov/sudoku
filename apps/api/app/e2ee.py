import base64
import uuid
from datetime import UTC,datetime

from fastapi import APIRouter,Depends,HTTPException,status
from pydantic import BaseModel,Field
from sqlalchemy import delete,select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .deps import AuthContext,get_auth_context
from .models import DeviceKeyBundle,DeviceOneTimePrekey
from .rate_limit import enforce_user_rate_limit

router=APIRouter(prefix="/v1/e2ee",tags=["e2ee"])


class DeviceBundleRequest(BaseModel):
    device_id:uuid.UUID
    protocol:str=Field(pattern="^(signal-v1|mls-v1)$")
    identity_key_b64:str=Field(min_length=16,max_length=4096)
    signed_prekey_b64:str=Field(min_length=16,max_length=4096)
    signed_prekey_signature_b64:str=Field(min_length=16,max_length=4096)
    one_time_prekeys_b64:list[str]=Field(default_factory=list,max_length=100)


def dec(value:str)->bytes:
    try:
        return base64.b64decode(value,validate=True)
    except Exception as exc:
        raise HTTPException(422,"Invalid base64 key material") from exc


def enc(value:bytes)->str:
    return base64.b64encode(value).decode()


@router.put("/devices/{device_id}",status_code=204)
async def put_bundle(
    device_id:uuid.UUID,
    payload:DeviceBundleRequest,
    auth:AuthContext=Depends(get_auth_context),
    db:AsyncSession=Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id,"e2ee-device-key",20,3600)
    if payload.device_id!=device_id:
        raise HTTPException(422,"Device ID mismatch")
    decoded_prekeys=[dec(x) for x in payload.one_time_prekeys_b64]
    item=(await db.execute(
        select(DeviceKeyBundle)
        .where(DeviceKeyBundle.user_id==auth.user.id,DeviceKeyBundle.device_id==device_id)
        .with_for_update()
    )).scalar_one_or_none()
    values=dict(
        protocol=payload.protocol,
        identity_key=dec(payload.identity_key_b64),
        signed_prekey=dec(payload.signed_prekey_b64),
        signed_prekey_signature=dec(payload.signed_prekey_signature_b64),
        one_time_prekeys=[],
        updated_at=datetime.now(UTC),
        revoked_at=None,
    )
    if item is None:
        db.add(DeviceKeyBundle(user_id=auth.user.id,device_id=device_id,**values))
    else:
        for key,value in values.items():
            setattr(item,key,value)

    if decoded_prekeys:
        await db.execute(delete(DeviceOneTimePrekey).where(
            DeviceOneTimePrekey.user_id==auth.user.id,
            DeviceOneTimePrekey.device_id==device_id,
            DeviceOneTimePrekey.consumed_at.is_(None),
        ))
        for public_key in decoded_prekeys:
            db.add(DeviceOneTimePrekey(
                user_id=auth.user.id,
                device_id=device_id,
                key_id=uuid.uuid4(),
                public_key=public_key,
            ))
    await db.commit()


@router.get("/users/{user_id}/devices")
async def get_bundles(
    user_id:uuid.UUID,
    auth:AuthContext=Depends(get_auth_context),
    db:AsyncSession=Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id,"e2ee-key-fetch",120,60)
    rows=(await db.execute(select(DeviceKeyBundle).where(
        DeviceKeyBundle.user_id==user_id,
        DeviceKeyBundle.revoked_at.is_(None),
    ))).scalars().all()
    return [{
        "device_id":str(item.device_id),
        "protocol":item.protocol,
        "identity_key_b64":enc(item.identity_key),
        "signed_prekey_b64":enc(item.signed_prekey),
        "signed_prekey_signature_b64":enc(item.signed_prekey_signature),
    } for item in rows]


@router.post("/users/{user_id}/devices/{device_id}/prekey/claim")
async def claim_prekey(
    user_id:uuid.UUID,
    device_id:uuid.UUID,
    auth:AuthContext=Depends(get_auth_context),
    db:AsyncSession=Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id,"e2ee-prekey-claim",120,60)
    bundle=(await db.execute(select(DeviceKeyBundle).where(
        DeviceKeyBundle.user_id==user_id,
        DeviceKeyBundle.device_id==device_id,
        DeviceKeyBundle.revoked_at.is_(None),
    ))).scalar_one_or_none()
    if bundle is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,"Device key bundle not found")

    prekey=(await db.execute(
        select(DeviceOneTimePrekey)
        .where(
            DeviceOneTimePrekey.user_id==user_id,
            DeviceOneTimePrekey.device_id==device_id,
            DeviceOneTimePrekey.consumed_at.is_(None),
        )
        .order_by(DeviceOneTimePrekey.created_at,DeviceOneTimePrekey.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    )).scalar_one_or_none()
    if prekey is None:
        raise HTTPException(status.HTTP_409_CONFLICT,"No one-time prekey available")

    prekey.consumed_at=datetime.now(UTC)
    await db.flush()
    response={
        "device_id":str(bundle.device_id),
        "protocol":bundle.protocol,
        "identity_key_b64":enc(bundle.identity_key),
        "signed_prekey_b64":enc(bundle.signed_prekey),
        "signed_prekey_signature_b64":enc(bundle.signed_prekey_signature),
        "one_time_prekey":{
            "key_id":str(prekey.key_id),
            "public_key_b64":enc(prekey.public_key),
        },
    }
    await db.commit()
    return response


@router.delete("/devices/{device_id}",status_code=204)
async def revoke_bundle(
    device_id:uuid.UUID,
    auth:AuthContext=Depends(get_auth_context),
    db:AsyncSession=Depends(get_db),
):
    item=(await db.execute(select(DeviceKeyBundle).where(
        DeviceKeyBundle.user_id==auth.user.id,
        DeviceKeyBundle.device_id==device_id,
        DeviceKeyBundle.revoked_at.is_(None),
    ))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,"Device key not found")
    item.revoked_at=datetime.now(UTC)
    await db.commit()
