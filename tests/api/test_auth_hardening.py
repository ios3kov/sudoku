import uuid

import app.routes.auth as auth_routes
import httpx
import pytest
from app.main import app

ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}


@pytest.mark.asyncio(loop_scope="session")
async def test_unknown_login_still_runs_dummy_argon2_verification(monkeypatch) -> None:
    calls: list[tuple[str, str]] = []

    def fake_verify(password_hash: str, password: str) -> bool:
        calls.append((password_hash, password))
        return False

    monkeypatch.setattr(auth_routes, "verify_password", fake_verify)
    phone = f"+1555{str(uuid.uuid4().int % 10_000_000).zfill(7)}"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as client:
        response = await client.post(
            "/v1/auth/login",
            json={
                "phone": phone,
                "password": "wrong-password-value",
                "device_name": "timing-regression",
            },
        )

    assert response.status_code == 401
    assert calls == [(auth_routes._DUMMY_PASSWORD_HASH, "wrong-password-value")]
