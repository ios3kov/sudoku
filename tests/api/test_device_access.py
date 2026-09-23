"""Real PostgreSQL/Redis auth boundaries for session-bound PINs; synthetic accounts."""
import asyncio
import base64
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionFactory
from app.device_biometric import SessionBiometricCredential
from app.device_pin import DevicePinLocked, SessionPin
from app.main import app
from app.models import Asset, Session, User
from app.realtime import authenticate_websocket, session_still_valid
from app.security import hash_password, hash_secret

pytestmark = pytest.mark.asyncio(loop_scope="session")
ORIGIN = "https://sudoku.test"
PASSWORD = "pin acceptance account password"
ROOT = "/v1/auth/device-access"
HEADER = "X-Sudoku-Unlock"
COOKIE = get_settings().session_cookie_name


@asynccontextmanager
async def account(admin=False):
    suffix = uuid.uuid4().hex
    phone = "+" + str(76000000000 + (int(suffix[:8], 16) % 100000000))
    async with SessionFactory() as db:
        user = None
        if admin:
            user = (
                await db.execute(select(User).where(User.is_admin.is_(True)))
            ).scalar_one_or_none()
        if user is None:
            user = User(
                email=f"pin-{suffix}@example.com",
                display_name="PIN test",
                password_hash=hash_password(PASSWORD),
                status="active",
                is_admin=admin,
            )
            db.add(user)

        user.phone_e164 = phone
        user.phone_verified_at = datetime.now(UTC)
        user.display_name = "PIN test"
        user.password_hash = hash_password(PASSWORD)
        user.status = "active"
        await db.commit()

    transport = httpx.ASGITransport(app=app, client=(f"pin-test-{suffix}", 12345))
    async with httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers={"origin": ORIGIN}) as client:
        response = await client.post(
            "/v1/auth/login",
            json={"phone": phone, "password": PASSWORD, "device_name": "PIN test"},
        )
        assert response.status_code == 200, response.text
        assert "HttpOnly" in response.headers["set-cookie"]
        async with SessionFactory() as db:
            session_id = await db.scalar(select(Session.id).where(Session.token_hash == hash_secret(client.cookies.get(COOKIE))))
        yield client, user.id, session_id


async def enroll(client, pin="0123"):
    response = await client.put(ROOT, json={"password": PASSWORD, "pin": pin})
    assert response.status_code == 200, response.text
    return response.json()["unlock_token"]


@pytest.mark.parametrize("admin", [False, True])
async def test_role_parity_protected_apis_and_password_required_configuration(admin):
    async with account(admin) as (client, _, sid):
        assert (await client.get(ROOT)).json() == {"pin_enabled": False, "password_required": False, "biometric_enabled": False}
        assert (await client.put(ROOT, json={"password": "wrong", "pin": "0123"})).status_code == 403
        token = await enroll(client)
        for path in ("/v1/me", "/v1/sessions", "/v1/conversations"):
            assert (await client.get(path)).status_code == 423
            assert (await client.get(path, headers={HEADER: token})).status_code == 200
        assert (await client.post("/v1/auth/refresh")).status_code == 423
        assert (await client.get("/v1/me", headers={HEADER: token})).json()["is_admin"] is admin
        async with SessionFactory() as db:
            record = await db.get(SessionPin, sid)
            assert record.pin_hash.startswith("$argon2") and record.pin_hash != "0123"
            assert record.unlock_hash == hash_secret(token) and record.failed_attempts == 0
        assert (await client.put(ROOT, json={"password": "wrong", "pin": None})).status_code == 403
        assert (await client.put(ROOT, json={"password": PASSWORD, "pin": None})).status_code == 200
        assert (await client.get("/v1/me")).status_code == 200


async def test_native_biometric_challenge_is_session_bound_one_time_and_pin_gated():
    async with account() as (client, _, sid):
        token = await enroll(client)

        private_key = ec.generate_private_key(ec.SECP256R1())
        public_key = private_key.public_key().public_bytes(
            Encoding.X962,
            PublicFormat.UncompressedPoint,
        )
        public_key_b64 = base64.b64encode(public_key).decode("ascii")

        assert (
            await client.put(
                ROOT + "/biometric",
                json={"public_key_x963_b64": public_key_b64, "password": PASSWORD},
            )
        ).status_code == 423

        enrolled = await client.put(
            ROOT + "/biometric",
            headers={HEADER: token},
            json={"public_key_x963_b64": public_key_b64, "password": PASSWORD},
        )
        assert enrolled.status_code == 200, enrolled.text
        assert enrolled.json() == {"biometric_enabled": True}
        assert (await client.get(ROOT)).json()["biometric_enabled"] is True

        assert (await client.post(ROOT + "/lock", headers={HEADER: token})).status_code == 204

        challenge_response = await client.post(ROOT + "/biometric/challenge")
        assert challenge_response.status_code == 200, challenge_response.text
        challenge = challenge_response.json()
        assert len(challenge["challenge"]) == 43
        assert challenge["payload"].startswith(f"sudoku-biometric-unlock:v1:{sid}:")

        signature = private_key.sign(
            challenge["payload"].encode("ascii"),
            ec.ECDSA(hashes.SHA256()),
        )
        unlocked = await client.post(
            ROOT + "/biometric/unlock",
            json={
                "challenge": challenge["challenge"],
                "signature_b64": base64.b64encode(signature).decode("ascii"),
            },
        )
        assert unlocked.status_code == 200, unlocked.text
        biometric_token = unlocked.json()["unlock_token"]
        assert (await client.get("/v1/me", headers={HEADER: biometric_token})).status_code == 200

        replay = await client.post(
            ROOT + "/biometric/unlock",
            json={
                "challenge": challenge["challenge"],
                "signature_b64": base64.b64encode(signature).decode("ascii"),
            },
        )
        assert replay.status_code == 409

        second = (await client.post(ROOT + "/biometric/challenge")).json()
        wrong_signature = private_key.sign(b"wrong-payload", ec.ECDSA(hashes.SHA256()))
        rejected = await client.post(
            ROOT + "/biometric/unlock",
            json={
                "challenge": second["challenge"],
                "signature_b64": base64.b64encode(wrong_signature).decode("ascii"),
            },
        )
        assert rejected.status_code == 403

        consumed = await client.post(
            ROOT + "/biometric/unlock",
            json={
                "challenge": second["challenge"],
                "signature_b64": base64.b64encode(wrong_signature).decode("ascii"),
            },
        )
        assert consumed.status_code == 409

        changed = await client.put(
            ROOT,
            json={"password": PASSWORD, "pin": "4321"},
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["biometric_enabled"] is False
        assert (await client.get(ROOT)).json()["biometric_enabled"] is False

        async with SessionFactory() as db:
            assert await db.get(SessionBiometricCredential, sid) is None


async def test_pin_lockout_blocks_biometric_until_password_recovery():
    async with account() as (client, _, _):
        token = await enroll(client)
        private_key = ec.generate_private_key(ec.SECP256R1())
        public_key = private_key.public_key().public_bytes(
            Encoding.X962,
            PublicFormat.UncompressedPoint,
        )
        enrolled = await client.put(
            ROOT + "/biometric",
            headers={HEADER: token},
            json={"public_key_x963_b64": base64.b64encode(public_key).decode("ascii"), "password": PASSWORD},
        )
        assert enrolled.status_code == 200

        for _ in range(5):
            await client.post(ROOT + "/unlock", json={"pin": "9999"})

        blocked = await client.post(ROOT + "/biometric/challenge")
        assert blocked.status_code == 429
        assert blocked.headers.get("X-PIN-Password-Required") == "true"

        recovered = await client.post(ROOT + "/password", json={"password": PASSWORD})
        assert recovered.status_code == 200
        challenge = await client.post(ROOT + "/biometric/challenge")
        assert challenge.status_code == 200


async def test_exact_ascii_digits_preserve_leading_zero_and_do_not_accept_pin_as_password():
    async with account() as (client, _, _):
        for value in ("123", "12345", "12a4", "１２３４", "١٢٣٤", "123\n", 1234):
            assert (await client.put(ROOT, json={"password": PASSWORD, "pin": value})).status_code == 422
        await enroll(client, "0007")
        assert (await client.post(ROOT + "/unlock", json={"pin": "0007"})).status_code == 200
        assert (await client.post(ROOT + "/password", json={"password": "0007"})).status_code == 403


async def test_five_concurrent_wrong_attempts_persist_and_password_recovery_preserves_session():
    async with account() as (client, uid, sid):
        await enroll(client)
        replies = await asyncio.gather(*(client.post(ROOT + "/unlock", json={"pin": "9876"}) for _ in range(7)))
        assert sorted(r.status_code for r in replies) == [403, 403, 403, 403, 429, 429, 429]
        assert (await client.get(ROOT)).json()["password_required"] is True
        assert (await client.post(ROOT + "/unlock", json={"pin": "0123"})).status_code == 429
        async with SessionFactory() as db:
            assert (await db.get(SessionPin, sid)).failed_attempts == 5
        recovery = await client.post(ROOT + "/password", json={"password": PASSWORD})
        assert recovery.status_code == 200
        token = recovery.json()["unlock_token"]
        sessions = await client.get("/v1/sessions", headers={HEADER: token})
        assert sessions.status_code == 200, sessions.text
        items = sessions.json()
        assert isinstance(items, list), items
        current = [item for item in items if item["current"]]
        assert len(current) == 1, {"sessions": items, "expected_session": str(sid)}
        assert current[0]["id"] == str(sid)
        async with SessionFactory() as db:
            assert (await db.get(SessionPin, sid)).failed_attempts == 0
            live = await db.scalar(select(Session).where(Session.token_hash == hash_secret(client.cookies.get(COOKIE))))
            assert live.id == sid and live.user_id == uid


async def test_ticket_binding_rotation_stale_lock_and_expiry():
    async with account() as (first, _, sid), account() as (second, _, _):
        old = await enroll(first)
        other = await enroll(second)
        assert (await first.get("/v1/me", headers={HEADER: other})).status_code == 423
        assert (await second.get("/v1/me", headers={HEADER: old})).status_code == 423
        newer = (await first.post(ROOT + "/unlock", json={"pin": "0123"})).json()["unlock_token"]
        assert (await first.post(ROOT + "/lock", headers={HEADER: old})).status_code == 204
        assert (await first.get("/v1/me", headers={HEADER: newer})).status_code == 200
        old_cookie = first.cookies.get(COOKIE)
        assert (await first.post("/v1/auth/refresh", headers={HEADER: newer})).status_code == 204
        assert old_cookie != first.cookies.get(COOKIE)
        assert (await first.get("/v1/me", headers={HEADER: newer})).status_code == 200
        async with SessionFactory() as db:
            row = await db.get(SessionPin, sid)
            row.unlock_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        assert (await first.get("/v1/me", headers={HEADER: newer})).status_code == 423
        assert (await first.post(ROOT + "/unlock", json={"pin": "0123"})).status_code == 200


@pytest.mark.parametrize("end", ["logout", "revoke", "expire"])
async def test_pin_never_restores_ended_session(end):
    async with account() as (client, _, sid):
        token = await enroll(client)
        if end == "logout":
            assert (await client.post("/v1/auth/logout")).status_code == 204
        elif end == "revoke":
            assert (await client.delete(f"/v1/sessions/{sid}", headers={HEADER: token})).status_code == 204
        else:
            async with SessionFactory() as db:
                session = await db.get(Session, sid)
                session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
                await db.commit()
        assert (await client.post(ROOT + "/unlock", json={"pin": "0123"})).status_code == 401
        assert (await client.post(ROOT + "/password", json={"password": PASSWORD})).status_code == 401
        assert (await client.get("/v1/me", headers={HEADER: token})).status_code == 401


async def test_websocket_cookie_alone_is_not_enough_and_existing_socket_loses_access_on_lock():
    async with account() as (client, uid, sid):
        token = await enroll(client)
        socket = SimpleNamespace(cookies={COOKIE: client.cookies.get(COOKIE)}, headers={})
        with pytest.raises(DevicePinLocked):
            await authenticate_websocket(socket)
        socket.headers = {"sec-websocket-protocol": f"sudoku.v1, sudoku-unlock.{token}"}
        assert (await authenticate_websocket(socket))[1] == sid
        assert await session_still_valid(sid, uid, token)
        assert (await client.post(ROOT + "/lock", headers={HEADER: token})).status_code == 204
        with pytest.raises(DevicePinLocked):
            await session_still_valid(sid, uid, token)


async def test_download_link_requires_pin_and_existing_asset_authorization():
    async with account() as (owner, uid, _), account() as (stranger, _, _):
        token = await enroll(owner)
        foreign_token = await enroll(stranger)
        asset_id = uuid.uuid4()
        async with SessionFactory() as db:
            db.add(Asset(id=asset_id, owner_id=uid, storage_key=f"pin-test/{asset_id}", filename="encrypted.bin", mime_type="application/octet-stream", size_bytes=1, sha256=b"x" * 32, e2ee_ciphertext=True, status="ready"))
            await db.commit()
        path = f"/v1/assets/{asset_id}/download-url"
        assert (await owner.get(path)).status_code == 423
        assert (await stranger.get(path, headers={HEADER: foreign_token})).status_code == 404
        response = await owner.get(path, headers={HEADER: token})
        assert response.status_code == 200
        assert response.json()["expires_in"] == 300
        assert response.json()["url"].startswith(("https://", "http://"))
        assert token not in response.text


@pytest.mark.parametrize("representation", ["uuid", "hyphenated", "hex"])
async def test_session_list_canonicalizes_equivalent_uuid_representations(representation):
    from app.db import get_db
    from app.deps import get_auth_context

    sid = uuid.uuid4()
    uid = uuid.uuid4()
    observed = {"uuid": sid, "hyphenated": str(sid), "hex": sid.hex}[representation]
    now = datetime.now(UTC)
    row = SimpleNamespace(id=observed, device_name="PIN test", ip_hash=None, created_at=now,
                          expires_at=now + timedelta(days=1), revoked_at=None)

    class Result:
        def scalars(self):
            return self

        def all(self):
            return [row]

    class Database:
        async def execute(self, _query):
            return Result()

    # Supply the same identity through the route's scalar and ORM context views.
    # Only this response-format test overrides authentication; the real PIN
    # and recovery tests above exercise the unmodified authentication chain.
    auth = SimpleNamespace(user_id=uid, session_id=sid,
                           user=SimpleNamespace(id=uid), session=SimpleNamespace(id=sid))

    async def override_auth():
        return auth

    async def override_db():
        yield Database()

    previous = app.dependency_overrides.copy()
    try:
        app.dependency_overrides[get_auth_context] = override_auth
        app.dependency_overrides[get_db] = override_db
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=ORIGIN) as client:
            response = await client.get("/v1/sessions")
        assert response.status_code == 200, response.text
        result = response.json()
        assert len(result) == 1
        assert result[0]["id"] == str(sid)
        assert result[0]["current"] is True
        assert row.id == observed  # Never mutate database identity as a display fix.
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
