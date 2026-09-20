import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import AuthContext, get_auth_context
from ..models import AuditEvent, Invite, LoginAttempt, MlsDevice, MlsKeyPackage, Session, User
from ..rate_limit import enforce_ip_rate_limit, enforce_login_rate_limit, enforce_user_rate_limit
from ..mls_lifecycle import schedule_mls_device_change
from ..schemas import InviteAcceptRequest, InviteCreateRequest, InviteCreateResponse, LoginRequest, SessionResponse, UserResponse
from ..security import (
    email_audit_hash,
    generate_invite_secret,
    generate_session_secret,
    hash_password,
    hash_secret,
    normalize_email,
    session_expiry,
    verify_password,
)

router = APIRouter(prefix="/v1", tags=["auth"])
settings = get_settings()


def _set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=raw_token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )


async def _revoke_session_mls_device(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    revoked_at: datetime,
) -> None:
    device = (
        await db.execute(
            select(MlsDevice).where(
                MlsDevice.user_id == user_id,
                MlsDevice.device_id == session_id,
            )
        )
    ).scalar_one_or_none()
    if device is not None and device.revoked_at is None:
        device.revoked_at = revoked_at
        await schedule_mls_device_change(
            db, user_id, session_id, "device_remove"
        )
    await db.execute(
        delete(MlsKeyPackage).where(
            MlsKeyPackage.user_id == user_id,
            MlsKeyPackage.device_id == session_id,
            MlsKeyPackage.claimed_at.is_(None),
        )
    )


async def _new_session(db: AsyncSession, user: User, device_name: str) -> tuple[Session, str]:
    secret = generate_session_secret()
    session = Session(
        user_id=user.id,
        token_hash=secret.digest,
        device_name=device_name,
        expires_at=session_expiry(settings.session_ttl_days),
    )
    db.add(session)
    await db.flush()
    return session, secret.raw


@router.post("/auth/login", response_model=UserResponse)
async def login(payload: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    email = normalize_email(str(payload.email))
    client_ip = request.client.host if request.client else "unknown"
    await enforce_login_rate_limit(client_ip, email)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    succeeded = bool(user and user.status == "active" and verify_password(user.password_hash, payload.password))
    db.add(LoginAttempt(email_hash=email_audit_hash(email), succeeded=1 if succeeded else 0))

    if not succeeded or user is None:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    session, raw_token = await _new_session(db, user, payload.device_name)
    user.last_seen_at = datetime.now(UTC)
    db.add(AuditEvent(actor_user_id=user.id, event_type="auth.login", target_type="session", target_id=session.id))
    await db.commit()
    _set_session_cookie(response, raw_token)
    return UserResponse(id=user.id, email=user.email, display_name=user.display_name, is_admin=user.is_admin)


@router.post("/auth/refresh", status_code=204)
async def refresh_session(response: Response, auth: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    # Keep the session UUID stable: it is the cryptographic device id. Rotate
    # only the bearer secret. The original hash is captured before the lock so
    # a concurrent refresh that already won cannot be overwritten by a stale
    # request.
    expected_token_hash = bytes(auth.session.token_hash)
    current = (
        await db.execute(
            select(Session)
            .where(Session.id == auth.session.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if (
        current is None
        or current.revoked_at is not None
        or current.expires_at <= now
        or current.token_hash != expected_token_hash
    ):
        _clear_session_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    secret = generate_session_secret()
    current.token_hash = secret.digest
    current.expires_at = session_expiry(settings.session_ttl_days)
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="auth.session_rotated",
            target_type="session",
            target_id=current.id,
        )
    )
    await db.commit()
    _set_session_cookie(response, secret.raw)


@router.post("/auth/logout", status_code=204)
async def logout(response: Response, auth: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    now = datetime.now(UTC)
    auth.session.revoked_at = now
    await _revoke_session_mls_device(db, auth.user.id, auth.session.id, now)
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="auth.logout", target_type="session", target_id=auth.session.id))
    await db.commit()
    _clear_session_cookie(response)


@router.get("/me", response_model=UserResponse)
async def me(auth: AuthContext = Depends(get_auth_context)):
    return UserResponse(id=auth.user.id, email=auth.user.email, display_name=auth.user.display_name, is_admin=auth.user.is_admin)


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(auth: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    await enforce_user_rate_limit(auth.user.id, "session-list", 60, 60)
    now = datetime.now(UTC)
    rows = (
        await db.execute(
            select(Session)
            .where(Session.user_id == auth.user.id, Session.revoked_at.is_(None), Session.expires_at > now)
            .order_by(Session.created_at.desc())
        )
    ).scalars().all()
    return [
        SessionResponse(
            id=item.id,
            device_name=item.device_name,
            created_at=item.created_at,
            expires_at=item.expires_at,
            current=item.id == auth.session.id,
        )
        for item in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID,
    response: Response,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "session-revoke", 30, 3600)
    session = (
        await db.execute(select(Session).where(Session.id == session_id, Session.user_id == auth.user.id))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    now = datetime.now(UTC)
    session.revoked_at = now
    await _revoke_session_mls_device(db, auth.user.id, session.id, now)
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="auth.session_revoked", target_type="session", target_id=session.id))
    await db.commit()
    if session.id == auth.session.id:
        _clear_session_cookie(response)


def _require_admin(auth: AuthContext) -> None:
    if not auth.user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


@router.post("/invites", response_model=InviteCreateResponse, status_code=201)
async def create_invite(
    payload: InviteCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    _require_admin(auth)
    await enforce_user_rate_limit(auth.user.id, "invite-create", 20, 3600)
    secret = generate_invite_secret()
    email = normalize_email(str(payload.email)) if payload.email is not None else None
    invite = Invite(
        token_hash=secret.digest,
        email=email,
        created_by=auth.user.id,
        expires_at=datetime.now(UTC) + timedelta(hours=payload.expires_hours),
        max_uses=payload.max_uses,
        uses=0,
    )
    db.add(invite)
    await db.flush()
    db.add(AuditEvent(actor_user_id=auth.user.id, event_type="invite.created", target_type="invite", target_id=invite.id))
    await db.commit()
    return InviteCreateResponse(
        id=invite.id,
        token=secret.raw,
        email=invite.email,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
    )


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(
    invite_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    _require_admin(auth)
    await enforce_user_rate_limit(auth.user.id, "invite-revoke", 60, 3600)
    invite = (await db.execute(select(Invite).where(Invite.id == invite_id))).scalar_one_or_none()
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.revoked_at is None:
        invite.revoked_at = datetime.now(UTC)
        db.add(AuditEvent(actor_user_id=auth.user.id, event_type="invite.revoked", target_type="invite", target_id=invite.id))
        await db.commit()


@router.post("/invites/accept", response_model=UserResponse, status_code=201)
async def accept_invite(payload: InviteAcceptRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(client_ip, "invite-accept", 20, 900)
    now = datetime.now(UTC)
    email = normalize_email(str(payload.email))
    invite = (
        await db.execute(select(Invite).where(Invite.token_hash == hash_secret(payload.token)).with_for_update())
    ).scalar_one_or_none()
    if invite is None or invite.revoked_at is not None or invite.expires_at <= now or invite.uses >= invite.max_uses:
        raise HTTPException(status_code=404, detail="Invite is invalid or expired")
    if invite.email is not None and normalize_email(invite.email) != email:
        raise HTTPException(status_code=403, detail="Invite is not valid for this email")
    existing = (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Account already exists")

    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        status="active",
    )
    db.add(user)
    await db.flush()
    invite.uses += 1
    session, raw_token = await _new_session(db, user, payload.device_name)
    db.add(AuditEvent(actor_user_id=user.id, event_type="invite.accepted", target_type="invite", target_id=invite.id))
    db.add(AuditEvent(actor_user_id=user.id, event_type="auth.login", target_type="session", target_id=session.id))
    await db.commit()
    _set_session_cookie(response, raw_token)
    return UserResponse(id=user.id, email=user.email, display_name=user.display_name, is_admin=user.is_admin)
