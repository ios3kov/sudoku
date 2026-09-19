from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import Session, User
from .security import hash_secret

settings = get_settings()


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: Session


async def get_auth_context(
    db: AsyncSession = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> AuthContext:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    now = datetime.now(UTC)
    query = (
        select(Session, User)
        .join(User, User.id == Session.user_id)
        .where(
            Session.token_hash == hash_secret(session_token),
            Session.revoked_at.is_(None),
            Session.expires_at > now,
            User.status == "active",
        )
    )
    row = (await db.execute(query)).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    session, user = row
    return AuthContext(user=user, session=session)
