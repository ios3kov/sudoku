import asyncio
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from app.db import SessionFactory
from app.main import app
from app.models import Conversation, User, UserContact
from app.security import hash_password
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

ORIGIN = "https://sudoku.test"
HEADERS = {"origin": ORIGIN}
PASSWORD = "correct horse battery staple"


def synthetic_phone(seed: int) -> str:
    return "+" + str(71000000000 + seed)


async def create_user(seed: int, name: str, *, phone: bool = True) -> User:
    user = User(
        email=f"phone-{seed}-{uuid.uuid4().hex[:8]}@example.com",
        phone_e164=synthetic_phone(seed) if phone else None,
        phone_verified_at=datetime.now(UTC) if phone else None,
        display_name=name,
        password_hash=hash_password(PASSWORD),
        status="active",
        is_admin=False,
    )
    async with SessionFactory() as db:
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


async def phone_login(client: httpx.AsyncClient, user: User) -> None:
    response = await client.post(
        "/v1/auth/login",
        json={
            "phone": user.phone_e164,
            "password": PASSWORD,
            "device_name": "phone-contact-test",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["phone_e164"] == user.phone_e164


@pytest.mark.asyncio(loop_scope="session")
async def test_contact_sync_controls_directory_and_new_conversations() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000
    owner = await create_user(seed, "Owner")
    peer = await create_user(seed + 1, "Peer")
    stranger = await create_user(seed + 2, "Stranger")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=HEADERS,
    ) as client:
        await phone_login(client, owner)

        empty = await client.get("/v1/users")
        assert empty.status_code == 200
        assert empty.json() == []

        blocked = await client.post(
            "/v1/conversations",
            json={
                "type": "direct",
                "title": None,
                "member_ids": [str(peer.id)],
                "encryption_required": False,
            },
        )
        assert blocked.status_code == 403

        synced = await client.post(
            "/v1/contacts/sync",
            json={"phones": [peer.phone_e164], "replace": False},
        )
        assert synced.status_code == 200, synced.text
        assert [item["id"] for item in synced.json()] == [str(peer.id)]
        assert synced.json()[0]["phone_e164"] == peer.phone_e164

        directory = await client.get("/v1/users?q=Peer")
        assert directory.status_code == 200
        assert [item["id"] for item in directory.json()] == [str(peer.id)]
        assert "email" not in directory.json()[0]

        allowed = await client.post(
            "/v1/conversations",
            json={
                "type": "direct",
                "title": None,
                "member_ids": [str(peer.id)],
                "encryption_required": False,
            },
        )
        assert allowed.status_code == 201, allowed.text

        stranger_blocked = await client.post(
            "/v1/conversations",
            json={
                "type": "group",
                "title": "Blocked group",
                "member_ids": [str(stranger.id)],
                "encryption_required": False,
            },
        )
        assert stranger_blocked.status_code == 403

        replaced = await client.post(
            "/v1/contacts/sync",
            json={"phones": [stranger.phone_e164], "replace": True},
        )
        assert replaced.status_code == 200
        assert [item["id"] for item in replaced.json()] == [str(stranger.id)]

        blocked_send = await client.post(
            f"/v1/conversations/{allowed.json()['id']}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": "must be blocked",
                "asset_ids": [],
            },
        )
        assert blocked_send.status_code == 403

        old_contact = await client.get("/v1/users?q=Peer")
        assert old_contact.json() == []
        new_contact = await client.get("/v1/users?q=Stranger")
        assert [item["id"] for item in new_contact.json()] == [str(stranger.id)]


@pytest.mark.asyncio(loop_scope="session")
async def test_direct_chat_create_is_idempotent_for_both_participants() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000 + 100000
    owner = await create_user(seed, "Direct Owner")
    peer = await create_user(seed + 1, "Direct Peer")

    async with SessionFactory() as db:
        db.add_all([
            UserContact(owner_user_id=owner.id, contact_user_id=peer.id),
            UserContact(owner_user_id=peer.id, contact_user_id=owner.id),
        ])
        await db.commit()

    payload_for_peer = {
        "type": "direct",
        "title": None,
        "member_ids": [str(peer.id)],
        "encryption_required": True,
    }
    payload_for_owner = {
        "type": "direct",
        "title": None,
        "member_ids": [str(owner.id)],
        "encryption_required": True,
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url=ORIGIN, headers=HEADERS
    ) as owner_client, httpx.AsyncClient(
        transport=transport, base_url=ORIGIN, headers=HEADERS
    ) as peer_client:
        await phone_login(owner_client, owner)
        await phone_login(peer_client, peer)

        first, second = await asyncio.gather(
            owner_client.post("/v1/conversations", json=payload_for_peer),
            owner_client.post("/v1/conversations", json=payload_for_peer),
        )
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        conversation_id = first.json()["id"]
        assert second.json()["id"] == conversation_id

        # The other participant can resolve/open the same pending direct row.
        reused = await peer_client.post("/v1/conversations", json=payload_for_owner)
        assert reused.status_code == 201, reused.text
        assert reused.json()["id"] == conversation_id

    direct_key = ":".join(sorted([str(owner.id), str(peer.id)]))
    async with SessionFactory() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(Conversation)
            .where(Conversation.direct_key == direct_key)
        )
        assert int(count or 0) == 1


@pytest.mark.asyncio(loop_scope="session")
async def test_phone_update_disables_legacy_email_login_for_migrated_account() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000 + 200000
    legacy = await create_user(seed, "Legacy", phone=False)
    replacement_phone = synthetic_phone(seed)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=HEADERS,
    ) as client:
        legacy_login = await client.post(
            "/v1/auth/login",
            json={
                "email": legacy.email,
                "password": PASSWORD,
                "device_name": "legacy-migration",
            },
        )
        assert legacy_login.status_code == 200

        wrong_password = await client.put(
            "/v1/me/phone",
            json={"phone": replacement_phone, "password": "wrong"},
        )
        assert wrong_password.status_code == 403

        updated = await client.put(
            "/v1/me/phone",
            json={"phone": replacement_phone, "password": PASSWORD},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["phone_e164"] == replacement_phone

        await client.post("/v1/auth/logout")
        email_after_migration = await client.post(
            "/v1/auth/login",
            json={
                "email": legacy.email,
                "password": PASSWORD,
                "device_name": "legacy-email-blocked",
            },
        )
        assert email_after_migration.status_code == 401

        phone_after_migration = await client.post(
            "/v1/auth/login",
            json={
                "phone": replacement_phone,
                "password": PASSWORD,
                "device_name": "phone-login",
            },
        )
        assert phone_after_migration.status_code == 200


@pytest.mark.asyncio(loop_scope="session")
async def test_phone_bound_invite_creates_phone_identity() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000 + 400000
    async with SessionFactory() as db:
        admin = (
            await db.execute(select(User).where(User.is_admin.is_(True)))
        ).scalar_one_or_none()
        if admin is None:
            admin = User(
                email=f"admin-{uuid.uuid4().hex[:8]}@example.test",
                phone_e164=synthetic_phone(seed),
                phone_verified_at=datetime.now(UTC),
                display_name="Admin",
                password_hash=hash_password(PASSWORD),
                status="active",
                is_admin=True,
            )
            db.add(admin)
        else:
            admin.phone_verified_at = datetime.now(UTC)
            admin.password_hash = hash_password(PASSWORD)
            admin.status = "active"
        await db.commit()
        await db.refresh(admin)

    invited_phone = synthetic_phone(seed + 1)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=HEADERS,
    ) as admin_client:
        await phone_login(admin_client, admin)
        created = await admin_client.post(
            "/v1/invites",
            json={"phone": invited_phone, "expires_hours": 1, "max_uses": 1},
        )
        assert created.status_code == 201, created.text
        token = created.json()["token"]

        async with httpx.AsyncClient(
            transport=transport,
            base_url=ORIGIN,
            headers=HEADERS,
        ) as member_client:
            mismatch = await member_client.post(
                "/v1/invites/accept",
                json={
                    "token": token,
                    "phone": synthetic_phone(seed + 2),
                    "display_name": "Wrong",
                    "password": PASSWORD,
                    "device_name": "wrong-phone",
                },
            )
            assert mismatch.status_code == 403

            accepted = await member_client.post(
                "/v1/invites/accept",
                json={
                    "token": token,
                    "phone": invited_phone,
                    "display_name": "Invited",
                    "password": PASSWORD,
                    "device_name": "phone-invite",
                },
            )
            assert accepted.status_code == 201, accepted.text
            assert accepted.json()["phone_e164"] == invited_phone
            user_id = uuid.UUID(accepted.json()["id"])

    async with SessionFactory() as db:
        created_user = await db.scalar(select(User).where(User.id == user_id))
        assert created_user is not None
        assert created_user.phone_e164 == invited_phone


@pytest.mark.asyncio(loop_scope="session")
async def test_phone_change_invalidates_inbound_contact_edges() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000 + 600000
    watcher = await create_user(seed, "Watcher")
    target = await create_user(seed + 1, "Target")

    async with SessionFactory() as db:
        db.add(UserContact(owner_user_id=watcher.id, contact_user_id=target.id))
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=HEADERS,
    ) as client:
        await phone_login(client, target)
        changed = await client.put(
            "/v1/me/phone",
            json={"phone": synthetic_phone(seed + 2), "password": PASSWORD},
        )
        assert changed.status_code == 200, changed.text

    async with SessionFactory() as db:
        edge = await db.get(UserContact, (watcher.id, target.id))
        assert edge is None


@pytest.mark.asyncio(loop_scope="session")
async def test_database_rejects_second_global_admin_and_member_invites() -> None:
    seed = int(uuid.uuid4().hex[:6], 16) % 100000 + 800000

    async with SessionFactory() as db:
        admin = (
            await db.execute(select(User).where(User.is_admin.is_(True)))
        ).scalar_one_or_none()
        if admin is None:
            admin = User(
                email=f"singleton-admin-{uuid.uuid4().hex[:8]}@example.test",
                phone_e164=synthetic_phone(seed),
                phone_verified_at=datetime.now(UTC),
                display_name="Singleton Admin",
                password_hash=hash_password(PASSWORD),
                status="active",
                is_admin=True,
            )
            db.add(admin)
            await db.commit()

    second_admin = User(
        email=f"second-admin-{uuid.uuid4().hex[:8]}@example.test",
        phone_e164=synthetic_phone(seed + 1),
        phone_verified_at=datetime.now(UTC),
        display_name="Second Admin",
        password_hash=hash_password(PASSWORD),
        status="active",
        is_admin=True,
    )
    async with SessionFactory() as db:
        db.add(second_admin)
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()

    member = await create_user(seed + 2, "Invite-less Member")
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=HEADERS,
    ) as admin_client:
        await phone_login(admin_client, admin)
        created = await admin_client.post(
            "/v1/invites",
            json={
                "phone": synthetic_phone(seed + 4),
                "expires_hours": 1,
                "max_uses": 1,
            },
        )
        assert created.status_code == 201, created.text
        invite_id = created.json()["id"]

        async with httpx.AsyncClient(
            transport=transport,
            base_url=ORIGIN,
            headers=HEADERS,
        ) as member_client:
            await phone_login(member_client, member)
            denied = await member_client.post(
                "/v1/invites",
                json={
                    "phone": synthetic_phone(seed + 3),
                    "expires_hours": 1,
                    "max_uses": 1,
                },
            )
            assert denied.status_code == 403

            revoke_denied = await member_client.delete(f"/v1/invites/{invite_id}")
            assert revoke_denied.status_code == 403

        revoked = await admin_client.delete(f"/v1/invites/{invite_id}")
        assert revoked.status_code == 204
