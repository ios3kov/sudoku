import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
_DEVICE_PIN_CONTEXT = "sudoku-device-pin:v1:"
# Fixed Argon2id verifier used to keep unknown/inactive-account login timing close to real accounts.
# It is not a credential and never authenticates a user.
DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$HoiosE7ghuoDOzBBPimMAw$DvYE3U2quNZVA4eKChHK+16KILQagt69OwOUif+P8xM"


@dataclass(frozen=True)
class SessionSecret:
    raw: str
    digest: bytes


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def normalize_phone_e164(phone: str) -> str:
    value = re.sub(r"[\s().-]+", "", phone.strip())
    if re.fullmatch(r"\+[1-9][0-9]{7,14}", value) is None:
        raise ValueError("Phone number must use international E.164 format")
    return value


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


def identifier_audit_hash(identifier: str) -> bytes:
    return hashlib.sha256(identifier.strip().casefold().encode("utf-8")).digest()


def email_audit_hash(email: str) -> bytes:
    # Backward-compatible helper for older call sites during the phone migration.
    return identifier_audit_hash(normalize_email(email))


def session_expiry(ttl_days: int) -> datetime:
    return datetime.now(UTC) + timedelta(days=ttl_days)
