import base64
import uuid
from datetime import UTC,datetime
from fastapi import APIRouter,Depends,HTTPException,status
from pydantic import BaseModel,Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .db import get_db
from .deps import AuthContext,get_auth_context
from .models import DeviceKeyBundle
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
    try:return base64.b64decode(value,validate=True)
    except Exception as exc:raise HTTPException(422,"Invalid base64 key material") from exc

def enc(value:bytes)->str:return base64.b64encode(value).decode()

@router.put("/devices/{device_id}",status_code=204)
async def put_bundle(device_id:uuid.UUID,payload:DeviceBundleRequest,auth:AuthContext=Depends(get_auth_context),db:AsyncSession=Depends(get_db)):
    await enforce_user_rate_limit(auth.user.id,"e2ee-device-key",20,3600)
    if payload.device_id!=device_id:raise HTTPException(422,"Device ID mismatch")
    item=(await db.execute(select(DeviceKeyBundle).where(DeviceKeyBundle.user_id==auth.user.id,DeviceKeyBundle.device_id==device_id))).scalar_one_or_none()
    values=dict(protocol=payload.protocol,identity_key=dec(payload.identity_key_b64),signed_prekey=dec(payload.signed_prekey_b64),signed_prekey_signature=dec(payload.signed_prekey_signature_b64),one_time_prekeys=[dec(x).hex() for x in payload.one_time_prekeys_b64],updated_at=datetime.now(UTC),revoked_at=None)
    if item is None:db.add(DeviceKeyBundle(user_id=auth.user.id,device_id=device_id,**values))
    else:
        for k,v in values.items():setattr(item,k,v)
    await db.commit()

@router.get("/users/{user_id}/devices")
async def get_bundles(user_id:uuid.UUID,auth:AuthContext=Depends(get_auth_context),db:AsyncSession=Depends(get_db)):
    await enforce_user_rate_limit(auth.user.id,"e2ee-key-fetch",120,60)
    rows=(await db.execute(select(DeviceKeyBundle).where(DeviceKeyBundle.user_id==user_id,DeviceKeyBundle.revoked_at.is_(None)))).scalars().all()
    return [{"device_id":str(x.device_id),"protocol":x.protocol,"identity_key_b64":enc(x.identity_key),"signed_prekey_b64":enc(x.signed_prekey),"signed_prekey_signature_b64":enc(x.signed_prekey_signature),"one_time_prekeys_b64":[enc(bytes.fromhex(v)) for v in x.one_time_prekeys]} for x in rows]

@router.delete("/devices/{device_id}",status_code=204)
async def revoke_bundle(device_id:uuid.UUID,auth:AuthContext=Depends(get_auth_context),db:AsyncSession=Depends(get_db)):
    item=(await db.execute(select(DeviceKeyBundle).where(DeviceKeyBundle.user_id==auth.user.id,DeviceKeyBundle.device_id==device_id,DeviceKeyBundle.revoked_at.is_(None)))).scalar_one_or_none()
    if item is None:raise HTTPException(status.HTTP_404_NOT_FOUND,"Device key not found")
    item.revoked_at=datetime.now(UTC);await db.commit()
