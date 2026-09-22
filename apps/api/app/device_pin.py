"""Session-bound online device lock, not an account password or E2EE key wrapper."""
import hmac
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String, select
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base
from .security import generate_session_secret, hash_secret

PIN_LIMIT = 5
UNLOCK_LIFETIME = timedelta(hours=12)
UNLOCK_HEADER = "X-Sudoku-Unlock"


class SessionPin(Base):
    __tablename__ = "session_pins"
    __table_args__ = (CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 5", name="ck_session_pin_attempts"),)

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True,
    )
    pin_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    unlock_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    unlock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DevicePinLocked(Exception):
    """A live session needs its device PIN; do not treat as revoked MLS state."""


def pin_token_matches(pin: SessionPin, token: str | None) -> bool:
    return bool(
        isinstance(token, str) and 32 <= len(token) <= 128 and pin.unlock_hash
        and hmac.compare_digest(bytes(pin.unlock_hash), hash_secret(token))
    )


async def pin_allows(db: AsyncSession, session_id: uuid.UUID, token: str | None) -> bool:
    pin = (await db.execute(select(SessionPin).where(SessionPin.session_id == session_id))).scalar_one_or_none()
    if pin is None:
        return True
    return bool(
        pin.failed_attempts < PIN_LIMIT
        and pin.unlock_expires_at is not None
        and pin.unlock_expires_at > datetime.now(UTC)
        and pin_token_matches(pin, token)
    )


def issue_unlock(pin: SessionPin, session_expires: datetime) -> str:
    secret = generate_session_secret()
    pin.unlock_hash = secret.digest
    pin.unlock_expires_at = min(session_expires, datetime.now(UTC) + UNLOCK_LIFETIME)
    pin.failed_attempts = 0
    return secret.raw


def forget_unlock(pin: SessionPin) -> None:
    pin.unlock_hash = None
    pin.unlock_expires_at = None
