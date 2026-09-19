import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import AuthContext, get_auth_context
from ..models import PushSubscription
from ..rate_limit import enforce_user_rate_limit
from ..schemas import PushPublicKeyResponse, PushSubscriptionRequest

router = APIRouter(prefix="/v1/push", tags=["push"])
settings = get_settings()


def _validate_push_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unsupported push endpoint") from exc
    allowed = tuple(item.strip().lower().lstrip(".") for item in settings.web_push_allowed_hosts.split(",") if item.strip())
    host_allowed = any(host == suffix or host.endswith("." + suffix) for suffix in allowed)
    if (
        parsed.scheme != "https"
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not host_allowed
    ):
        raise HTTPException(status_code=422, detail="Unsupported push endpoint")


@router.get("/public-key", response_model=PushPublicKeyResponse)
async def public_key(auth: AuthContext = Depends(get_auth_context)):
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="Push is not configured")
    return PushPublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscriptions", status_code=204)
async def save_subscription(
    payload: PushSubscriptionRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "push-subscribe", 10, 3600)
    _validate_push_endpoint(payload.endpoint)
    existing = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            PushSubscription(
                user_id=auth.user.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
                device_name=payload.device_name,
            )
        )
    else:
        if existing.user_id != auth.user.id:
            raise HTTPException(status_code=409, detail="Subscription already belongs to another account")
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.device_name = payload.device_name
        existing.revoked_at = None
    await db.commit()


@router.delete("/subscriptions/{subscription_id}", status_code=204)
async def revoke_subscription(
    subscription_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "push-revoke", 30, 3600)
    item = (
        await db.execute(
            select(PushSubscription).where(PushSubscription.id == subscription_id, PushSubscription.user_id == auth.user.id)
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    from datetime import UTC, datetime
    item.revoked_at = datetime.now(UTC)
    await db.commit()
