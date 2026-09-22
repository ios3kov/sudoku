"""Online PIN management for an already authenticated browser session."""
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import AuthContext, get_session_context
from ..device_pin import PIN_LIMIT, UNLOCK_HEADER, SessionPin, forget_unlock, issue_unlock, pin_token_matches
from ..models import AuditEvent, Session
from ..rate_limit import enforce_ip_rate_limit, enforce_login_rate_limit, enforce_user_rate_limit
from ..security import hash_device_pin, verify_device_pin, verify_password

router = APIRouter(prefix="/v1/auth/device-access", tags=["auth"])


class PinRequest(BaseModel):
    pin: SecretStr


class PasswordRequest(BaseModel):
    password: SecretStr


class ConfigureRequest(PasswordRequest):
    pin: SecretStr | None


def read_pin(secret: SecretStr) -> str:
    value = secret.get_secret_value()
    if re.fullmatch(r"[0-9]{4}", value) is None:
        raise HTTPException(status_code=422, detail="PIN must contain exactly four digits")
    return value


async def current_locked(db: AsyncSession, auth: AuthContext) -> Session:
    # Lock the parent even when no PIN row exists: simultaneous first-time
    # enrollment and unlock attempts must serialize across all API workers.
    expected_hash = bytes(auth.session.token_hash)
    current = (await db.execute(
        select(Session).where(Session.id == auth.session.id).with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if (current is None or current.revoked_at is not None or current.expires_at <= datetime.now(UTC)
            or current.token_hash != expected_hash):
        raise HTTPException(status_code=401, detail="Authentication required")
    return current


async def load_pin(db: AsyncSession, session: Session) -> SessionPin | None:
    return (await db.execute(
        select(SessionPin).where(SessionPin.session_id == session.id)
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def check_password(request: Request, auth: AuthContext, value: SecretStr) -> None:
    password = value.get_secret_value()
    ip = request.client.host if request.client else "unknown"
    await enforce_login_rate_limit(ip, auth.user.email)
    if not 1 <= len(password) <= 1024 or not await run_in_threadpool(verify_password, auth.user.password_hash, password):
        # 403 distinguishes an incorrect password from an expired session.
        raise HTTPException(status_code=403, detail="Invalid password")


def audit(db: AsyncSession, auth: AuthContext, event: str) -> None:
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type=event, target_type="session", target_id=auth.session.id))


@router.get("")
async def access_status(auth: AuthContext = Depends(get_session_context), db: AsyncSession = Depends(get_db)):
    pin = await load_pin(db, auth.session)
    # No account name, email, session secret or PIN verifier is returned here.
    return {"pin_enabled": pin is not None, "password_required": bool(pin and pin.failed_attempts >= PIN_LIMIT)}


@router.put("")
async def configure(
    payload: ConfigureRequest, request: Request,
    auth: AuthContext = Depends(get_session_context), db: AsyncSession = Depends(get_db),
):
    code = read_pin(payload.pin) if payload.pin is not None else None
    await check_password(request, auth, payload.password)
    encoded = await run_in_threadpool(hash_device_pin, code) if code is not None else None
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    if code is None:
        if pin is not None:
            await db.delete(pin)
        audit(db, auth, "auth.device_pin_disabled")
        await db.commit()
        return {"pin_enabled": False, "unlock_token": None}
    if pin is None:
        pin = SessionPin(session_id=current.id, pin_hash=encoded)
        db.add(pin)
    else:
        pin.pin_hash = encoded
    token = issue_unlock(pin, current.expires_at)
    audit(db, auth, "auth.device_pin_configured")
    await db.commit()
    return {"pin_enabled": True, "unlock_token": token}


@router.post("/unlock")
async def unlock(
    payload: PinRequest, request: Request,
    auth: AuthContext = Depends(get_session_context), db: AsyncSession = Depends(get_db),
):
    code = read_pin(payload.pin)
    ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(ip, "device-pin", 30, 60)
    await enforce_user_rate_limit(auth.session.id, "device-pin", 10, 60)
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    if pin is None:
        raise HTTPException(status_code=409, detail="Device PIN is not enabled")
    if pin.failed_attempts >= PIN_LIMIT:
        raise HTTPException(status_code=429, detail="Password required", headers={"X-PIN-Password-Required": "true"})
    if not await run_in_threadpool(verify_device_pin, pin.pin_hash, code):
        pin.failed_attempts += 1
        if pin.failed_attempts >= PIN_LIMIT:
            forget_unlock(pin)
        blocked = pin.failed_attempts >= PIN_LIMIT
        audit(db, auth, "auth.device_pin_failed")
        await db.commit()  # Persist the failure before raising the HTTP error.
        raise HTTPException(
            status_code=429 if blocked else 403,
            detail="Password required" if blocked else "Incorrect PIN",
            headers={"X-PIN-Password-Required": "true"} if blocked else None,
        )
    token = issue_unlock(pin, current.expires_at)
    audit(db, auth, "auth.device_pin_unlocked")
    await db.commit()
    return {"unlock_token": token}


@router.post("/password")
async def password_unlock(
    payload: PasswordRequest, request: Request,
    auth: AuthContext = Depends(get_session_context), db: AsyncSession = Depends(get_db),
):
    await check_password(request, auth, payload.password)
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    if pin is None:
        raise HTTPException(status_code=409, detail="Device PIN is not enabled")
    token = issue_unlock(pin, current.expires_at)
    audit(db, auth, "auth.device_pin_password_recovery")
    await db.commit()
    return {"unlock_token": token}


@router.post("/lock", status_code=204)
async def lock(
    auth: AuthContext = Depends(get_session_context), db: AsyncSession = Depends(get_db),
    unlock_token: str | None = Header(default=None, alias=UNLOCK_HEADER),
):
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    # A late lock from an older page must not revoke a newer unlock capability.
    if pin is not None and pin_token_matches(pin, unlock_token):
        forget_unlock(pin)
        await db.commit()
