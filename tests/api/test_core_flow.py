import base64
import hashlib
import uuid
from datetime import UTC, datetime

import httpx
import pytest
from app.db import SessionFactory
from app.main import app
from app.models import (
    Asset,
    Conversation,
    ConversationMember,
    Invite,
    Message,
    MessageAsset,
    User,
)
from app.security import hash_password
from sqlalchemy import select

ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}

@pytest.mark.asyncio(loop_scope="session")
async def test_invite_message_idempotency_asset_and_origin_boundary() -> None:
    suffix = uuid.uuid4().hex[:10]
    admin_email = f"admin-{suffix}@example.com"
    member_email = f"member-{suffix}@example.com"
    phone_seed = int(suffix[:4], 16)
    admin_phone = "+" + str(73000000000 + phone_seed * 2)
    member_phone = "+" + str(73000000000 + phone_seed * 2 + 1)
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        admin = (
            await db.execute(select(User).where(User.is_admin.is_(True)))
        ).scalar_one_or_none()
        if admin is None:
            admin = User(
                email=admin_email,
                phone_e164=admin_phone,
                phone_verified_at=datetime.now(UTC),
                display_name="Admin",
                password_hash=hash_password(password),
                status="active",
                is_admin=True,
            )
            db.add(admin)
        else:
            admin.email = admin_email
            admin.phone_e164 = admin_phone
            admin.phone_verified_at = datetime.now(UTC)
            admin.display_name = "Admin"
            admin.password_hash = hash_password(password)
            admin.status = "active"
        await db.commit()
        await db.refresh(admin)
        admin_id = admin.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS) as admin_client:
        login = await admin_client.post(
            "/v1/auth/login",
            json={"phone": admin_phone, "password": password, "device_name": "integration-test"},
        )
        assert login.status_code == 200, login.text
        assert login.headers.get("cache-control") == "no-store"
        assert login.json()["is_admin"] is True

        invite_response = await admin_client.post(
            "/v1/invites",
            json={"phone": member_phone, "email": member_email, "expires_hours": 1, "max_uses": 1},
        )
        assert invite_response.status_code == 201, invite_response.text
        invite_json = invite_response.json()
        raw_invite = invite_json["token"]

        async with SessionFactory() as db:
            invite = (await db.execute(select(Invite).where(Invite.id == uuid.UUID(invite_json["id"])))).scalar_one()
            assert invite.token_hash != raw_invite.encode("utf-8")

        async with httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS) as member_client:
            accepted = await member_client.post(
                "/v1/invites/accept",
                json={
                    "token": raw_invite,
                    "phone": member_phone,
                    "email": member_email,
                    "password": password,
                    "device_name": "integration-test-member",
                },
            )
            assert accepted.status_code == 201, accepted.text
            member_id = accepted.json()["id"]
            assert accepted.json()["is_admin"] is False
            assert accepted.json()["profile_setup_completed"] is False
            assert accepted.json()["display_name"] == "New member"

            profile = await member_client.put(
                "/v1/me/display-name",
                json={"display_name": " Member ✦ "},
            )
            assert profile.status_code == 200, profile.text
            assert profile.json()["display_name"] == "Member ✦"
            assert profile.json()["profile_setup_completed"] is True

            synced = await admin_client.post(
                "/v1/contacts/sync",
                json={"phones": [member_phone], "replace": False},
            )
            assert synced.status_code == 200, synced.text

            conversation_response = await admin_client.post(
                "/v1/conversations",
                json={"type": "direct", "title": None, "member_ids": [member_id]},
            )
            assert conversation_response.status_code == 201, conversation_response.text
            conversation_id = conversation_response.json()["id"]

            client_id = str(uuid.uuid4())
            payload = {"client_id": client_id, "type": "text", "body": "hello", "reply_to": None, "asset_ids": []}
            first = await admin_client.post(f"/v1/conversations/{conversation_id}/messages", json=payload)
            retry = await admin_client.post(f"/v1/conversations/{conversation_id}/messages", json=payload)
            assert first.status_code == 201, first.text
            assert retry.status_code == 201, retry.text
            assert first.json()["id"] == retry.json()["id"]
            assert first.json()["sequence"] == retry.json()["sequence"] == 1

            history = await member_client.get(f"/v1/conversations/{conversation_id}/messages?after=0&limit=50")
            assert history.status_code == 200, history.text
            assert [item["body"] for item in history.json()] == ["hello"]

            search = await member_client.get(f"/v1/conversations/{conversation_id}/search?q=hello")
            assert search.status_code == 200, search.text
            assert [item["id"] for item in search.json()] == [first.json()["id"]]

            preferences = await member_client.patch(
                f"/v1/conversations/{conversation_id}/preferences",
                json={"is_pinned": True, "notifications_muted": True},
            )
            assert preferences.status_code == 200, preferences.text
            assert preferences.json()["is_pinned"] is True
            assert preferences.json()["notifications_muted"] is True

            listed = await member_client.get("/v1/conversations")
            assert listed.status_code == 200, listed.text
            listed_direct = next(item for item in listed.json() if item["id"] == conversation_id)
            assert listed_direct["is_pinned"] is True
            assert listed_direct["notifications_muted"] is True

            group_response = await admin_client.post(
                "/v1/conversations",
                json={"type": "group", "title": "Family", "member_ids": [member_id]},
            )
            assert group_response.status_code == 201, group_response.text
            group_id = group_response.json()["id"]

            renamed = await admin_client.patch(f"/v1/conversations/{group_id}", json={"title": "Family chat"})
            assert renamed.status_code == 200, renamed.text
            assert renamed.json()["title"] == "Family chat"

            non_owner_rename = await member_client.patch(f"/v1/conversations/{group_id}", json={"title": "Nope"})
            assert non_owner_rename.status_code == 403

            last_owner_leave = await admin_client.delete(f"/v1/conversations/{group_id}/members/{admin_id}")
            assert last_owner_leave.status_code == 409

            promoted = await admin_client.patch(
                f"/v1/conversations/{group_id}/members/{member_id}",
                json={"role": "owner"},
            )
            assert promoted.status_code == 200, promoted.text
            assert any(item["id"] == member_id and item["role"] == "owner" for item in promoted.json()["members"])

            bad_origin = await admin_client.post(
                f"/v1/conversations/{conversation_id}/messages",
                headers={"origin": "https://evil.example"},
                json={"client_id": str(uuid.uuid4()), "type": "text", "body": "blocked", "asset_ids": []},
            )
            assert bad_origin.status_code == 403

            missing_origin = await admin_client.post(
                f"/v1/conversations/{conversation_id}/messages",
                headers={"origin": ""},
                json={"client_id": str(uuid.uuid4()), "type": "text", "body": "blocked", "asset_ids": []},
            )
            assert missing_origin.status_code == 403

            raw_file = b"private attachment\n"
            digest = hashlib.sha256(raw_file).hexdigest()
            intent = await admin_client.post(
                "/v1/assets/upload-intents",
                json={
                    "filename": "note.txt",
                    "mime_type": "text/plain",
                    "size_bytes": len(raw_file),
                    "sha256_hex": digest,
                },
            )
            assert intent.status_code == 201, intent.text
            intent_json = intent.json()

            async with httpx.AsyncClient() as storage_client:
                uploaded = await storage_client.put(intent_json["upload_url"], content=raw_file, headers=intent_json["headers"])
                assert uploaded.status_code in {200, 204}, uploaded.text

            completed = await admin_client.post(f"/v1/assets/{intent_json['asset_id']}/complete")
            assert completed.status_code == 200, completed.text
            assert completed.json()["sha256_hex"] == digest

            file_message = await admin_client.post(
                f"/v1/conversations/{conversation_id}/messages",
                json={
                    "client_id": str(uuid.uuid4()),
                    "type": "file",
                    "body": "note.txt",
                    "reply_to": None,
                    "asset_ids": [intent_json["asset_id"]],
                },
            )
            assert file_message.status_code == 201, file_message.text
            assert file_message.json()["assets"][0]["filename"] == "note.txt"

            content = await member_client.get(
                f"/v1/assets/{intent_json['asset_id']}/content",
                follow_redirects=False,
            )
            assert content.status_code == 302
            assert ("X-Amz-Signature=" in content.headers["location"] or "Signature=" in content.headers["location"])

            ssrf = await member_client.post(
                "/v1/push/subscriptions",
                json={
                    "endpoint": "https://127.0.0.1/internal",
                    "keys": {"p256dh": "x", "auth": "y"},
                    "device_name": "bad endpoint",
                },
            )
            assert ssrf.status_code == 422

        sessions = await admin_client.get("/v1/sessions")
        assert sessions.status_code == 200, sessions.text
        current_session = next(item for item in sessions.json() if item["current"])
        revoked = await admin_client.delete(f"/v1/sessions/{current_session['id']}")
        assert revoked.status_code == 204, revoked.text
        assert "sudoku_session=" in revoked.headers.get("set-cookie", "")
        after_revoke = await admin_client.get("/v1/me")
        assert after_revoke.status_code == 401

    # The admin ID is used to ensure the setup row existed and avoids linting it as accidental state.
    assert isinstance(admin_id, uuid.UUID)

@pytest.mark.asyncio(loop_scope="session")
async def test_e2ee_conversation_rejects_plaintext_and_stores_envelope_only() -> None:
    suffix=uuid.uuid4().hex[:10]
    email=f"e2ee-{suffix}@example.com"
    password="correct horse battery staple"
    peer_email=f"e2ee-peer-{suffix}@example.com"
    async with SessionFactory() as db:
        user=User(email=email,display_name="E2EE",password_hash=hash_password(password),status="active",is_admin=False)
        peer=User(email=peer_email,display_name="E2EE Peer",password_hash=hash_password(password),status="active",is_admin=False)
        db.add_all([user,peer]);await db.commit();await db.refresh(peer)
        peer_id=peer.id
    transport=httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport,base_url=ORIGIN,headers=MUTATION_HEADERS) as client:
        assert (await client.post("/v1/auth/login",json={"email":email,"password":password,"device_name":"e2ee-test"})).status_code==200
        created=await client.post("/v1/conversations",json={"type":"direct","title":None,"member_ids":[str(peer_id)],"encryption_required":True})
        assert created.status_code==201,created.text
        assert created.json()["encryption_required"] is True
        assert created.json()["e2ee_ready"] is False
        cid=created.json()["id"]
        pending_message=await client.post(
            f"/v1/conversations/{cid}/messages",
            json={"client_id":str(uuid.uuid4()),"type":"text","body":None,"envelope":{"version":1,"protocol":"mls-rfc9420","kind":"application","ciphertext":"AA=="},"asset_ids":[]},
        )
        assert pending_message.status_code==409
        # This test isolates the post-activation ciphertext boundary. MLS activation
        # itself is covered by the dedicated device/Welcome coverage integration test.
        async with SessionFactory() as db:
            conversation = (
                await db.execute(
                    select(Conversation).where(Conversation.id == uuid.UUID(cid))
                )
            ).scalar_one()
            conversation.e2ee_ready = True
            await db.commit()
        plaintext=await client.post(f"/v1/conversations/{cid}/messages",json={"client_id":str(uuid.uuid4()),"type":"text","body":"secret plaintext","asset_ids":[]})
        assert plaintext.status_code==422
        envelope={"version":1,"protocol":"test-envelope","ciphertext":"AAECAwQ="}
        encrypted=await client.post(f"/v1/conversations/{cid}/messages",json={"client_id":str(uuid.uuid4()),"type":"text","body":None,"envelope":envelope,"asset_ids":[]})
        assert encrypted.status_code==201,encrypted.text
        assert encrypted.json()["body"] is None
        assert encrypted.json()["envelope"]==envelope
        search=await client.get(f"/v1/conversations/{cid}/search?q=secret")
        assert search.status_code==409

        ciphertext = b"\x01\x99\x00opaque-ciphertext-without-file-signature\xff"
        ciphertext_digest = hashlib.sha256(ciphertext).hexdigest()
        e2ee_intent = await client.post(
            "/v1/assets/e2ee-upload-intents",
            json={
                "size_bytes": len(ciphertext),
                "sha256_hex": ciphertext_digest,
            },
        )
        assert e2ee_intent.status_code == 201, e2ee_intent.text
        e2ee_intent_json = e2ee_intent.json()
        async with httpx.AsyncClient() as storage_client:
            uploaded = await storage_client.put(
                e2ee_intent_json["upload_url"],
                content=ciphertext,
                headers=e2ee_intent_json["headers"],
            )
            assert uploaded.status_code in {200, 204}, uploaded.text
        e2ee_complete = await client.post(
            f"/v1/assets/{e2ee_intent_json['asset_id']}/complete"
        )
        assert e2ee_complete.status_code == 200, e2ee_complete.text
        assert e2ee_complete.json()["e2ee_ciphertext"] is True
        assert e2ee_complete.json()["filename"] == "encrypted.bin"
        assert e2ee_complete.json()["mime_type"] == "application/octet-stream"

        # The signed creation condition prevents reuse from replacing ready bytes.
        assert e2ee_intent_json["headers"]["If-None-Match"] == "*"
        from urllib.parse import parse_qs, urlparse
        signed_headers = parse_qs(urlparse(e2ee_intent_json["upload_url"]).query)["X-Amz-SignedHeaders"][0]
        assert "if-none-match" in signed_headers.split(";")
        async with httpx.AsyncClient() as storage_client:
            repeated = await storage_client.put(
                e2ee_intent_json["upload_url"],
                content=b"changed-object",
                headers=e2ee_intent_json["headers"],
            )
            assert repeated.status_code == 412, repeated.text
        # Completion remains idempotent after an unsuccessful replacement.
        assert (await client.post(
            f"/v1/assets/{e2ee_intent_json['asset_id']}/complete"
        )).status_code == 200

        encrypted_file = await client.post(
            f"/v1/conversations/{cid}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "file",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "test-envelope",
                    "ciphertext": "encrypted-file-metadata",
                },
                "asset_ids": [e2ee_intent_json["asset_id"]],
            },
        )
        assert encrypted_file.status_code == 201, encrypted_file.text
        assert encrypted_file.json()["assets"][0]["e2ee_ciphertext"] is True

        plaintext_file = b"plaintext metadata leak test"
        plaintext_digest = hashlib.sha256(plaintext_file).hexdigest()
        legacy_intent = await client.post(
            "/v1/assets/upload-intents",
            json={
                "filename": "secret-name.txt",
                "mime_type": "text/plain",
                "size_bytes": len(plaintext_file),
                "sha256_hex": plaintext_digest,
            },
        )
        assert legacy_intent.status_code == 201, legacy_intent.text
        legacy_intent_json = legacy_intent.json()
        async with httpx.AsyncClient() as storage_client:
            uploaded = await storage_client.put(
                legacy_intent_json["upload_url"],
                content=plaintext_file,
                headers=legacy_intent_json["headers"],
            )
            assert uploaded.status_code in {200, 204}, uploaded.text
        assert (
            await client.post(f"/v1/assets/{legacy_intent_json['asset_id']}/complete")
        ).status_code == 200
        leaked_asset = await client.post(
            f"/v1/conversations/{cid}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "file",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "test-envelope",
                    "ciphertext": "must-be-rejected",
                },
                "asset_ids": [legacy_intent_json["asset_id"]],
            },
        )
        assert leaked_asset.status_code == 422
    async with SessionFactory() as db:
        from app.models import Asset, Message
        row=(
            await db.execute(
                select(Message).where(
                    Message.conversation_id==uuid.UUID(cid),
                    Message.type=="text",
                )
            )
        ).scalar_one()
        assert row.body_text is None
        assert row.envelope==envelope
        encrypted_asset=(
            await db.execute(
                select(Asset).where(
                    Asset.id==uuid.UUID(e2ee_intent_json["asset_id"])
                )
            )
        ).scalar_one()
        assert encrypted_asset.e2ee_ciphertext is True
        assert encrypted_asset.filename=="encrypted.bin"
        assert encrypted_asset.mime_type=="application/octet-stream"

@pytest.mark.asyncio(loop_scope="session")
async def test_e2ee_legacy_message_mutations_fail_closed() -> None:
    suffix = uuid.uuid4().hex[:10]
    email = f"e2ee-events-{suffix}@example.com"
    peer_email = f"e2ee-events-peer-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        user = User(
            email=email,
            display_name="E2EE Events",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        peer = User(
            email=peer_email,
            display_name="E2EE Events Peer",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([user, peer])
        await db.commit()
        await db.refresh(peer)
        peer_id = peer.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as client:
        assert (
            await client.post(
                "/v1/auth/login",
                json={
                    "email": email,
                    "password": password,
                    "device_name": "e2ee-events",
                },
            )
        ).status_code == 200

        created = await client.post(
            "/v1/conversations",
            json={
                "type": "direct",
                "title": None,
                "member_ids": [str(peer_id)],
                "encryption_required": True,
            },
        )
        assert created.status_code == 201, created.text
        conversation_id = created.json()["id"]
        # This test targets fail-closed legacy mutation endpoints after an E2EE
        # conversation is active; activation coverage lives in the dedicated MLS test.
        async with SessionFactory() as db:
            conversation = (
                await db.execute(
                    select(Conversation).where(
                        Conversation.id == uuid.UUID(conversation_id)
                    )
                )
            ).scalar_one()
            conversation.e2ee_ready = True
            await db.commit()

        envelope = {
            "version": 1,
            "protocol": "mls-rfc9420",
            "kind": "application",
            "ciphertext": "AAECAwQ=",
        }
        created_message = await client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": envelope,
                "asset_ids": [],
            },
        )
        assert created_message.status_code == 201, created_message.text
        message_id = created_message.json()["id"]

        edited = await client.patch(
            f"/v1/messages/{message_id}",
            json={"body": "plaintext edit must not be stored"},
        )
        reacted = await client.post(
            f"/v1/messages/{message_id}/reactions",
            json={"emoji": "❤️"},
        )
        deleted = await client.delete(f"/v1/messages/{message_id}")

        assert edited.status_code == 409
        assert reacted.status_code == 409
        assert deleted.status_code == 409

    async with SessionFactory() as db:
        from app.models import Message, MessageReaction

        row = (
            await db.execute(select(Message).where(Message.id == uuid.UUID(message_id)))
        ).scalar_one()
        assert row.body_text is None
        assert row.envelope == envelope
        assert row.deleted_at is None
        reactions = (
            await db.execute(
                select(MessageReaction).where(MessageReaction.message_id == row.id)
            )
        ).scalars().all()
        assert reactions == []

@pytest.mark.asyncio(loop_scope="session")
async def test_session_refresh_keeps_device_id_and_revoke_disables_mls_device() -> None:
    suffix = uuid.uuid4().hex[:10]
    email = f"stable-device-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        user = User(
            email=email,
            display_name="Stable Device",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add(user)
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as client:
        login = await client.post(
            "/v1/auth/login",
            json={
                "email": email,
                "password": password,
                "device_name": "stable-device",
            },
        )
        assert login.status_code == 200, login.text

        sessions = await client.get("/v1/sessions")
        current_before = next(item for item in sessions.json() if item["current"])
        device_id = current_before["id"]

        registered = await client.put(
            f"/v1/e2ee/devices/{device_id}",
            json={
                "identity_public_key_b64": base64.b64encode(b"V" * 32).decode()
            },
        )
        assert registered.status_code == 204, registered.text

        refreshed = await client.post("/v1/auth/refresh")
        assert refreshed.status_code == 204, refreshed.text

        sessions_after = await client.get("/v1/sessions")
        current_after = next(item for item in sessions_after.json() if item["current"])
        assert current_after["id"] == device_id

        listed = await client.get(f"/v1/e2ee/users/{login.json()['id']}/devices")
        assert listed.status_code == 200, listed.text
        assert [item["device_id"] for item in listed.json()] == [device_id]

        revoked = await client.delete(f"/v1/sessions/{device_id}")
        assert revoked.status_code == 204, revoked.text

    async with SessionFactory() as db:
        from app.models import MlsDevice

        device = (
            await db.execute(
                select(MlsDevice).where(MlsDevice.device_id == uuid.UUID(device_id))
            )
        ).scalar_one()
        assert device.revoked_at is not None

@pytest.mark.asyncio(loop_scope="session")
async def test_pending_add_member_cannot_access_conversation_asset() -> None:
    suffix = uuid.uuid4().hex[:10]
    owner_email = f"asset-owner-{suffix}@example.com"
    pending_email = f"asset-pending-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        owner = User(
            email=owner_email,
            display_name="Asset Owner",
            password_hash=hash_password(password),
            status="active",
        )
        pending = User(
            email=pending_email,
            display_name="Pending Member",
            password_hash=hash_password(password),
            status="active",
        )
        db.add_all([owner, pending])
        await db.flush()

        conversation = Conversation(
            type="group",
            title="Pending authorization",
            created_by=owner.id,
            encryption_required=True,
            e2ee_ready=True,
        )
        db.add(conversation)
        await db.flush()
        db.add_all([
            ConversationMember(
                conversation_id=conversation.id,
                user_id=owner.id,
                role="owner",
                e2ee_state="active",
            ),
            ConversationMember(
                conversation_id=conversation.id,
                user_id=pending.id,
                role="member",
                e2ee_state="pending_add",
            ),
        ])

        asset = Asset(
            owner_id=owner.id,
            storage_key=f"tests/{suffix}/ciphertext",
            filename="encrypted.bin",
            mime_type="application/octet-stream",
            size_bytes=32,
            sha256=hashlib.sha256(b"x" * 32).digest(),
            e2ee_ciphertext=True,
            status="ready",
        )
        db.add(asset)
        await db.flush()

        message = Message(
            conversation_id=conversation.id,
            sender_id=owner.id,
            client_id=uuid.uuid4(),
            sequence=1,
            type="file",
            body_text=None,
            envelope={
                "version": 1,
                "protocol": "mls-rfc9420",
                "kind": "application",
                "ciphertext": "AA==",
            },
            encryption_version=1,
        )
        db.add(message)
        await db.flush()
        db.add(MessageAsset(message_id=message.id, asset_id=asset.id, position=0))
        await db.commit()
        asset_id = asset.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as pending_client:
        login = await pending_client.post(
            "/v1/auth/login",
            json={
                "email": pending_email,
                "password": password,
                "device_name": "pending-asset-test",
            },
        )
        assert login.status_code == 200, login.text
        denied = await pending_client.get(f"/v1/assets/{asset_id}")
        assert denied.status_code == 404
