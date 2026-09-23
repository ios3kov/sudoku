"""Session-bound native biometric public-key authentication."""

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import DateTime, ForeignKey, LargeBinary
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base

BIOMETRIC_CHALLENGE_LIFETIME = timedelta(seconds=90)
BIOMETRIC_CONTEXT = "sudoku-biometric-unlock:v1"


class SessionBiometricCredential(Base):
    __tablename__ = "session_biometric_credentials"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    public_key_x963: Mapped[bytes] = mapped_column(LargeBinary(65), nullable=False)
    challenge_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    challenge_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def decode_public_key_x963(encoded: str) -> bytes:
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("Invalid biometric public key") from exc
    if len(raw) != 65 or raw[0] != 0x04:
        raise ValueError("Invalid biometric public key")
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    except ValueError as exc:
        raise ValueError("Invalid biometric public key") from exc
    return raw


def issue_challenge(credential: SessionBiometricCredential, session_id: uuid.UUID) -> tuple[str, str]:
    challenge = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    credential.challenge_hash = hashlib.sha256(challenge.encode("ascii")).digest()
    credential.challenge_expires_at = datetime.now(UTC) + BIOMETRIC_CHALLENGE_LIFETIME
    return challenge, signed_payload(session_id, challenge).decode("ascii")


def signed_payload(session_id: uuid.UUID, challenge: str) -> bytes:
    return f"{BIOMETRIC_CONTEXT}:{session_id}:{challenge}".encode("ascii")


def challenge_is_current(credential: SessionBiometricCredential, challenge: str) -> bool:
    return bool(
        credential.challenge_hash
        and credential.challenge_expires_at
        and credential.challenge_expires_at > datetime.now(UTC)
        and hmac.compare_digest(
            bytes(credential.challenge_hash),
            hashlib.sha256(challenge.encode("ascii", errors="ignore")).digest(),
        )
    )


def clear_challenge(credential: SessionBiometricCredential) -> None:
    credential.challenge_hash = None
    credential.challenge_expires_at = None


def verify_signature(public_key_x963: bytes, payload: bytes, signature_b64: str) -> bool:
    try:
        signature = base64.b64decode(signature_b64, validate=True)
        public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_key_x963)
        public_key.verify(signature, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except (ValueError, InvalidSignature, base64.binascii.Error):
        return False
