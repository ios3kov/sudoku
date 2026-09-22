import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
_DEVICE_PIN_CONTEXT = "sudoku-device-pin:v1:"


@dataclass(frozen=True)
class SessionSecret:
    raw: str
    digest: bytes


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    return _PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _PASSWORD_HASHER.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def hash_device_pin(pin: str) -> str:
    """Hash a validated online-only PIN without relaxing account-password policy."""
    if re.fullmatch(r"[0-9]{4}", pin) is None:
        raise ValueError("PIN must contain exactly four digits")
    return _PASSWORD_HASHER.hash(_DEVICE_PIN_CONTEXT + pin)


def verify_device_pin(pin_hash: str, pin: str) -> bool:
    if re.fullmatch(r"[0-9]{4}", pin) is None:
        return False
    try:
        return _PASSWORD_HASHER.verify(pin_hash, _DEVICE_PIN_CONTEXT + pin)
    except (VerificationError, InvalidHashError):
        return False


def generate_session_secret() -> SessionSecret:
    raw = secrets.token_urlsafe(48)
    return SessionSecret(raw=raw, digest=hash_secret(raw))


def generate_invite_secret() -> SessionSecret:
    raw = secrets.token_urlsafe(32)
    return SessionSecret(raw=raw, digest=hash_secret(raw))


def hash_secret(raw: str) -> bytes:
    return hashlib.sha256(raw.encode("utf-8")).digest()


def email_audit_hash(email: str) -> bytes:
    return hashlib.sha256(normalize_email(email).encode("utf-8")).digest()


def session_expiry(ttl_days: int) -> datetime:
    return datetime.now(UTC) + timedelta(days=ttl_days)
