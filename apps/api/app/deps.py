from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .device_pin import UNLOCK_HEADER, pin_allows
from .models import Session, User
from .security import hash_secret

settings = get_settings()


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: Session


async def get_session_context(
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> AuthContext:
    """Cookie authentication only; use the PIN-gated dependency for private data."""
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    now = datetime.now(UTC)
    row = (await db.execute(
        select(Session, User).join(User, User.id == Session.user_id).where(
            Session.token_hash == hash_secret(session_token), Session.revoked_at.is_(None),
            Session.expires_at > now, User.status == "active",
        )
    )).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    session, user = row
    return AuthContext(user=user, session=session)


async def get_auth_context(
    request: Request,
    auth: AuthContext = Depends(get_session_context),
    db: AsyncSession = Depends(get_db),
    unlock_token: str | None = Header(default=None, alias=UNLOCK_HEADER),
) -> AuthContext:
    # Revoking one's own cookie is safe even from the PIN screen. No other
    # private route may bypass the capability gate, including /me and refresh.
    if request.method == "POST" and request.url.path == "/v1/auth/logout":
        return auth
    if not await pin_allows(db, auth.session.id, unlock_token):
        raise HTTPException(status_code=423, detail="Device PIN required")
    return auth
