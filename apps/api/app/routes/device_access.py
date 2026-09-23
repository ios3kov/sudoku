"""Online PIN and native biometric access for an authenticated device session."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import AuthContext, get_auth_context, get_session_context
from ..device_biometric import (
    SessionBiometricCredential,
    challenge_is_current,
    clear_challenge,
    decode_public_key_x963,
    issue_challenge,
    signed_payload,
    verify_signature,
)
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


class BiometricEnrollRequest(BaseModel):
    public_key_x963_b64: str = Field(min_length=80, max_length=128)


class BiometricUnlockRequest(BaseModel):
    challenge: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")
    signature_b64: str = Field(min_length=64, max_length=192, pattern=r"^[A-Za-z0-9+/]+={0,2}$")


def read_pin(secret: SecretStr) -> str:
    value = secret.get_secret_value()
    if len(value) != 4 or not value.isascii() or not value.isdigit():
        raise HTTPException(status_code=422, detail="PIN must contain exactly four digits")
    return value


async def current_locked(db: AsyncSession, auth: AuthContext) -> Session:
    # Lock the parent even when no PIN row exists: all PIN/biometric state
    # transitions serialize across API workers for this session.
    expected_hash = bytes(auth.session.token_hash)
    current = (
        await db.execute(
            select(Session)
            .where(Session.id == auth.session.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if (
        current is None
        or current.revoked_at is not None
        or current.expires_at <= datetime.now(UTC)
        or current.token_hash != expected_hash
    ):
        raise HTTPException(status_code=401, detail="Authentication required")
    return current


async def load_pin(db: AsyncSession, session: Session) -> SessionPin | None:
    return (
        await db.execute(
            select(SessionPin)
            .where(SessionPin.session_id == session.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def load_biometric(
    db: AsyncSession,
    session: Session,
) -> SessionBiometricCredential | None:
    return (
        await db.execute(
            select(SessionBiometricCredential)
            .where(SessionBiometricCredential.session_id == session.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def check_password(request: Request, auth: AuthContext, value: SecretStr) -> None:
    password = value.get_secret_value()
    ip = request.client.host if request.client else "unknown"
    await enforce_login_rate_limit(ip, auth.user.phone_e164 or auth.user.email or str(auth.user.id))
    if (
        not 1 <= len(password) <= 1024
        or not await run_in_threadpool(verify_password, auth.user.password_hash, password)
    ):
        # 403 distinguishes an incorrect password from an expired session.
        raise HTTPException(status_code=403, detail="Invalid password")


def audit(db: AsyncSession, auth: AuthContext, event: str) -> None:
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type=event,
            target_type="session",
            target_id=auth.session.id,
        )
    )


def require_pin_not_exhausted(pin: SessionPin) -> None:
    if pin.failed_attempts >= PIN_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Password required",
            headers={"X-PIN-Password-Required": "true"},
        )


@router.get("")
async def access_status(
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
):
    pin = await load_pin(db, auth.session)
    biometric = await load_biometric(db, auth.session)
    # No account identity, PIN verifier, public key, challenge or credential is returned here.
    return {
        "pin_enabled": pin is not None,
        "password_required": bool(pin and pin.failed_attempts >= PIN_LIMIT),
        "biometric_enabled": bool(pin and biometric),
    }


@router.put("")
async def configure(
    payload: ConfigureRequest,
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
):
    code = read_pin(payload.pin) if payload.pin is not None else None
    await check_password(request, auth, payload.password)
    encoded = await run_in_threadpool(hash_device_pin, code) if code is not None else None
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    biometric = await load_biometric(db, current)

    # A PIN change/removal deliberately invalidates the Secure Enclave binding.
    # The device must explicitly enroll biometrics again after the new PIN is active.
    if biometric is not None:
        await db.delete(biometric)

    if code is None:
        if pin is not None:
            await db.delete(pin)
        audit(db, auth, "auth.device_pin_disabled")
        await db.commit()
        return {"pin_enabled": False, "biometric_enabled": False, "unlock_token": None}

    if pin is None:
        pin = SessionPin(session_id=current.id, pin_hash=encoded)
        db.add(pin)
    else:
        pin.pin_hash = encoded
    token = issue_unlock(pin, current.expires_at)
    audit(db, auth, "auth.device_pin_configured")
    await db.commit()
    return {"pin_enabled": True, "biometric_enabled": False, "unlock_token": token}


@router.post("/unlock")
async def unlock(
    payload: PinRequest,
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
):
    code = read_pin(payload.pin)
    ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(ip, "device-pin", 30, 60)
    await enforce_user_rate_limit(auth.session.id, "device-pin", 10, 60)
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    if pin is None:
        raise HTTPException(status_code=409, detail="Device PIN is not enabled")
    require_pin_not_exhausted(pin)
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
    payload: PasswordRequest,
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
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


@router.put("/biometric")
async def enroll_biometric(
    payload: BiometricEnrollRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    try:
        public_key = decode_public_key_x963(payload.public_key_x963_b64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid biometric public key") from exc

    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    if pin is None:
        raise HTTPException(status_code=409, detail="Device PIN is not enabled")

    biometric = await load_biometric(db, current)
    if biometric is None:
        biometric = SessionBiometricCredential(
            session_id=current.id,
            public_key_x963=public_key,
        )
        db.add(biometric)
    else:
        biometric.public_key_x963 = public_key
        biometric.last_used_at = None
        clear_challenge(biometric)

    audit(db, auth, "auth.device_biometric_configured")
    await db.commit()
    return {"biometric_enabled": True}


@router.delete("/biometric", status_code=204)
async def disable_biometric(
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    current = await current_locked(db, auth)
    biometric = await load_biometric(db, current)
    if biometric is not None:
        await db.delete(biometric)
        audit(db, auth, "auth.device_biometric_disabled")
        await db.commit()


@router.post("/biometric/challenge")
async def biometric_challenge(
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(ip, "device-biometric", 30, 60)
    await enforce_user_rate_limit(auth.session.id, "device-biometric", 20, 60)

    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    biometric = await load_biometric(db, current)
    if pin is None or biometric is None:
        raise HTTPException(status_code=409, detail="Biometric unlock is not enabled")
    require_pin_not_exhausted(pin)

    challenge, signed = issue_challenge(biometric, current.id)
    await db.commit()
    return {"challenge": challenge, "payload": signed}


@router.post("/biometric/unlock")
async def biometric_unlock(
    payload: BiometricUnlockRequest,
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(ip, "device-biometric", 30, 60)
    await enforce_user_rate_limit(auth.session.id, "device-biometric", 20, 60)

    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    biometric = await load_biometric(db, current)
    if pin is None or biometric is None:
        raise HTTPException(status_code=409, detail="Biometric unlock is not enabled")
    require_pin_not_exhausted(pin)

    if not challenge_is_current(biometric, payload.challenge):
        clear_challenge(biometric)
        await db.commit()
        raise HTTPException(status_code=409, detail="Biometric challenge is invalid or expired")

    valid = verify_signature(
        bytes(biometric.public_key_x963),
        signed_payload(current.id, payload.challenge),
        payload.signature_b64,
    )
    clear_challenge(biometric)
    if not valid:
        audit(db, auth, "auth.device_biometric_failed")
        await db.commit()
        raise HTTPException(status_code=403, detail="Biometric verification failed")

    biometric.last_used_at = datetime.now(UTC)
    token = issue_unlock(pin, current.expires_at)
    audit(db, auth, "auth.device_biometric_unlocked")
    await db.commit()
    return {"unlock_token": token}


@router.post("/lock", status_code=204)
async def lock(
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
    unlock_token: str | None = Header(default=None, alias=UNLOCK_HEADER),
):
    current = await current_locked(db, auth)
    pin = await load_pin(db, current)
    # A late lock from an older page must not revoke a newer unlock capability.
    if pin is not None and pin_token_matches(pin, unlock_token):
        forget_unlock(pin)
        await db.commit()
