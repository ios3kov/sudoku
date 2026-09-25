import uuid

import httpx
import pytest

from app.db import SessionFactory
from app.main import app
from app.models import User
from app.security import DUMMY_PASSWORD_HASH


ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}


@pytest.mark.asyncio(loop_scope="session")
async def test_login_runs_same_password_verifier_for_missing_and_existing_accounts(monkeypatch) -> None:
    suffix = uuid.uuid4().hex[:10]
    existing_phone = "+" + str(75000000000 + int(suffix[:5], 16) % 1000000000)
    missing_phone = "+" + str(76000000000 + int(suffix[5:], 16) % 1000000000)
    existing_hash = "$argon2id$test-existing-hash"
    calls: list[str] = []

    async with SessionFactory() as db:
        db.add(
            User(
                phone_e164=existing_phone,
                display_name="Timing Test",
                password_hash=existing_hash,
                status="active",
                is_admin=False,
            )
        )
        await db.commit()

    def fake_verify_password(password_hash: str, password: str) -> bool:
        calls.append(password_hash)
        return False

    monkeypatch.setattr("app.routes.auth.verify_password", fake_verify_password)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as client:
        missing = await client.post(
            "/v1/auth/login",
            json={"phone": missing_phone, "password": "wrong password", "device_name": "timing-missing"},
        )
        existing = await client.post(
            "/v1/auth/login",
            json={"phone": existing_phone, "password": "wrong password", "device_name": "timing-existing"},
        )

    assert missing.status_code == 401
    assert existing.status_code == 401
    assert calls == [DUMMY_PASSWORD_HASH, existing_hash]
