import base64
import hashlib
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db import SessionFactory
from app.main import app
from app.models import Conversation, Invite, User
from app.security import hash_password

ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}


@pytest.mark.asyncio(loop_scope="session")
async def test_invite_message_idempotency_asset_and_origin_boundary() -> None:
    suffix = uuid.uuid4().hex[:10]
    admin_email = f"admin-{suffix}@example.com"
    member_email = f"member-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        admin = User(
            email=admin_email,
            display_name="Admin",
            password_hash=hash_password(password),
            status="active",
            is_admin=True,
        )
        db.add(admin)
        await db.commit()
        await db.refresh(admin)
        admin_id = admin.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS) as admin_client:
        login = await admin_client.post(
            "/v1/auth/login",
            json={"email": admin_email, "password": password, "device_name": "integration-test"},
        )
        assert login.status_code == 200, login.text
        assert login.json()["is_admin"] is True

        invite_response = await admin_client.post(
            "/v1/invites",
            json={"email": member_email, "expires_hours": 1, "max_uses": 1},
        )
        assert invite_response.status_code == 201, invite_response.text
        invite_json = invite_response.json()
        raw_invite = invite_json["token"]

        async with SessionFactory() as db:
            invite = (await db.execute(select(Invite).where(Invite.id == uuid.UUID(invite_json["id"])))).scalar_one()
            assert invite.token_hash != raw_invite.encode("utf-8")

        async with httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS) as member_client:
            accepted = await member_client.post(
                f"/v1/invites/{raw_invite}/accept",
                json={
                    "email": member_email,
                    "display_name": "Member",
                    "password": password,
                    "device_name": "integration-test-member",
                },
            )
            assert accepted.status_code == 201, accepted.text
            member_id = accepted.json()["id"]
            assert accepted.json()["is_admin"] is False

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
async def test_mls_key_packages_are_single_use_and_replay_protected() -> None:
    suffix = uuid.uuid4().hex[:10]
    email = f"mls-{suffix}@example.com"
    password = "correct horse battery staple"
    device_id: uuid.UUID | None = None

    async with SessionFactory() as db:
        user = User(
            email=email,
            display_name="MLS",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id

    kp1 = b"mls-key-package-one-" + uuid.uuid4().bytes
    kp2 = b"mls-key-package-two-" + uuid.uuid4().bytes
    identity_public_key_b64 = base64.b64encode(b"K" * 32).decode()
    payload = {
        "device_id": str(device_id),
        "key_packages_b64": [
            base64.b64encode(kp1).decode(),
            base64.b64encode(kp2).decode(),
        ],
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as client:
        login = await client.post(
            "/v1/auth/login",
            json={"email": email, "password": password, "device_name": "mls-test"},
        )
        assert login.status_code == 200, login.text
        sessions = await client.get("/v1/sessions")
        assert sessions.status_code == 200, sessions.text
        device_id = uuid.UUID(next(item["id"] for item in sessions.json() if item["current"]))
        payload["device_id"] = str(device_id)

        registered = await client.put(
            f"/v1/e2ee/devices/{device_id}",
            json={"identity_public_key_b64": identity_public_key_b64},
        )
        assert registered.status_code == 204, registered.text

        published = await client.put(
            f"/v1/e2ee/devices/{device_id}/key-packages",
            json=payload,
        )
        assert published.status_code == 204, published.text

        listed = await client.get(f"/v1/e2ee/users/{user_id}/devices")
        assert listed.status_code == 200, listed.text
        assert listed.json() == [
            {
                "device_id": str(device_id),
                "identity_public_key_b64": identity_public_key_b64,
                "available_key_packages": 2,
            }
        ]

        first = await client.post(
            f"/v1/e2ee/users/{user_id}/devices/{device_id}/key-package/claim"
        )
        second = await client.post(
            f"/v1/e2ee/users/{user_id}/devices/{device_id}/key-package/claim"
        )
        exhausted = await client.post(
            f"/v1/e2ee/users/{user_id}/devices/{device_id}/key-package/claim"
        )

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert exhausted.status_code == 409
        assert first.json()["user_id"] == str(user_id)
        assert second.json()["user_id"] == str(user_id)
        assert first.json()["package_ref"] != second.json()["package_ref"]
        assert {
            base64.b64decode(first.json()["key_package_b64"]),
            base64.b64decode(second.json()["key_package_b64"]),
        } == {kp1, kp2}

        replay = await client.put(
            f"/v1/e2ee/devices/{device_id}/key-packages",
            json={
                "device_id": str(device_id),
                "key_packages_b64": [base64.b64encode(kp1).decode()],
            },
        )
        assert replay.status_code == 204

    async with SessionFactory() as db:
        from app.models import MlsKeyPackage

        rows = (
            await db.execute(
                select(MlsKeyPackage).where(
                    MlsKeyPackage.user_id == user_id,
                    MlsKeyPackage.device_id == device_id,
                )
            )
        ).scalars().all()
        assert len(rows) == 2
        assert all(row.claimed_at is not None for row in rows)


@pytest.mark.asyncio(loop_scope="session")
async def test_mls_control_event_snapshot_survives_membership_removal_and_ack() -> None:
    suffix = uuid.uuid4().hex[:10]
    sender_email = f"mls-control-sender-{suffix}@example.com"
    recipient_email = f"mls-control-recipient-{suffix}@example.com"
    password = "correct horse battery staple"
    sender_device: uuid.UUID | None = None
    recipient_device: uuid.UUID | None = None

    async with SessionFactory() as db:
        sender = User(
            email=sender_email,
            display_name="MLS Sender",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        recipient = User(
            email=recipient_email,
            display_name="MLS Recipient",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([sender, recipient])
        await db.commit()
        await db.refresh(recipient)
        recipient_id = recipient.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as sender_client, httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as recipient_client:
        assert (
            await sender_client.post(
                "/v1/auth/login",
                json={
                    "email": sender_email,
                    "password": password,
                    "device_name": "sender-device",
                },
            )
        ).status_code == 200
        assert (
            await recipient_client.post(
                "/v1/auth/login",
                json={
                    "email": recipient_email,
                    "password": password,
                    "device_name": "recipient-device",
                },
            )
        ).status_code == 200

        sender_sessions = await sender_client.get("/v1/sessions")
        recipient_sessions = await recipient_client.get("/v1/sessions")
        sender_device = uuid.UUID(
            next(item["id"] for item in sender_sessions.json() if item["current"])
        )
        recipient_device = uuid.UUID(
            next(item["id"] for item in recipient_sessions.json() if item["current"])
        )

        sender_key_b64 = base64.b64encode(b"S" * 32).decode()
        recipient_key_b64 = base64.b64encode(b"R" * 32).decode()
        assert (
            await sender_client.put(
                f"/v1/e2ee/devices/{sender_device}",
                json={"identity_public_key_b64": sender_key_b64},
            )
        ).status_code == 204
        assert (
            await recipient_client.put(
                f"/v1/e2ee/devices/{recipient_device}",
                json={"identity_public_key_b64": recipient_key_b64},
            )
        ).status_code == 204

        conversation = await sender_client.post(
            "/v1/conversations",
            json={
                "type": "direct",
                "title": None,
                "member_ids": [str(recipient_id)],
                "encryption_required": True,
            },
        )
        assert conversation.status_code == 201, conversation.text
        conversation_id = conversation.json()["id"]

        raw_control = b"opaque-mls-remove-commit"
        created = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-events",
            json={
                "client_id": str(uuid.uuid4()),
                "sender_device_id": str(sender_device),
                "kind": "commit",
                "payload_b64": base64.b64encode(raw_control).decode(),
                "recipients": [
                    {
                        "user_id": str(recipient_id),
                        "device_id": str(recipient_device),
                    }
                ],
            },
        )
        assert created.status_code == 201, created.text
        event_id = created.json()["id"]
        assert created.json()["sequence"] == 1

        batch_commit_id = str(uuid.uuid4())
        batch_welcome_id = str(uuid.uuid4())
        batch_payload = {
            "sender_device_id": str(sender_device),
            "events": [
                {
                    "client_id": batch_commit_id,
                    "kind": "commit",
                    "payload_b64": base64.b64encode(b"opaque-batch-commit").decode(),
                    "recipients": [
                        {
                            "user_id": str(recipient_id),
                            "device_id": str(recipient_device),
                        }
                    ],
                },
                {
                    "client_id": batch_welcome_id,
                    "kind": "welcome",
                    "payload_b64": base64.b64encode(b"opaque-batch-welcome").decode(),
                    "recipients": [
                        {
                            "user_id": str(recipient_id),
                            "device_id": str(recipient_device),
                        }
                    ],
                },
            ],
        }
        batch = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json=batch_payload,
        )
        assert batch.status_code == 201, batch.text
        batch_events = batch.json()["events"]
        assert [item["sequence"] for item in batch_events] == [2, 3]

        batch_retry = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json=batch_payload,
        )
        assert batch_retry.status_code == 201, batch_retry.text
        assert [item["id"] for item in batch_retry.json()["events"]] == [
            item["id"] for item in batch_events
        ]

        conflicting_batch = {
            **batch_payload,
            "events": [
                batch_payload["events"][0],
                {
                    **batch_payload["events"][1],
                    "payload_b64": base64.b64encode(b"different-welcome").decode(),
                },
            ],
        }
        conflict = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json=conflicting_batch,
        )
        assert conflict.status_code == 409

        for batch_event in batch_events:
            batch_ack = await recipient_client.post(
                f"/v1/e2ee/control-events/{batch_event['id']}/ack",
                json={"device_id": str(recipient_device)},
            )
            assert batch_ack.status_code == 204, batch_ack.text

        async with SessionFactory() as db:
            from app.models import ConversationMember, MlsControlEvent, OutboxEvent

            control_row = (
                await db.execute(
                    select(MlsControlEvent).where(
                        MlsControlEvent.id == uuid.UUID(event_id)
                    )
                )
            ).scalar_one()
            assert control_row.payload == raw_control

            outbox_row = (
                await db.execute(
                    select(OutboxEvent).where(
                        OutboxEvent.aggregate_id == uuid.UUID(event_id),
                        OutboxEvent.event_type == "mls.control.created",
                    )
                )
            ).scalar_one()
            assert "payload_b64" not in outbox_row.payload

            membership = (
                await db.execute(
                    select(ConversationMember).where(
                        ConversationMember.conversation_id
                        == uuid.UUID(conversation_id),
                        ConversationMember.user_id == recipient_id,
                    )
                )
            ).scalar_one()
            await db.delete(membership)
            await db.commit()

        pending = await recipient_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{recipient_device}/control-events"
        )
        assert pending.status_code == 200, pending.text
        assert len(pending.json()) == 1
        assert pending.json()[0]["id"] == event_id
        assert base64.b64decode(pending.json()[0]["payload_b64"]) == raw_control

        acked = await recipient_client.post(
            f"/v1/e2ee/control-events/{event_id}/ack",
            json={"device_id": str(recipient_device)},
        )
        assert acked.status_code == 204, acked.text

        after_ack = await recipient_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{recipient_device}/control-events"
        )
        assert after_ack.status_code == 200, after_ack.text
        assert after_ack.json() == []


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
async def test_e2ee_transport_feed_orders_messages_and_control_events() -> None:
    suffix = uuid.uuid4().hex[:10]
    sender_email = f"transport-sender-{suffix}@example.com"
    recipient_email = f"transport-recipient-{suffix}@example.com"
    password = "correct horse battery staple"
    sender_device: uuid.UUID | None = None
    recipient_device: uuid.UUID | None = None

    async with SessionFactory() as db:
        sender = User(
            email=sender_email,
            display_name="Transport Sender",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        recipient = User(
            email=recipient_email,
            display_name="Transport Recipient",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([sender, recipient])
        await db.commit()
        await db.refresh(recipient)
        recipient_id = recipient.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as sender_client, httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as recipient_client:
        assert (
            await sender_client.post(
                "/v1/auth/login",
                json={
                    "email": sender_email,
                    "password": password,
                    "device_name": "transport-sender",
                },
            )
        ).status_code == 200
        assert (
            await recipient_client.post(
                "/v1/auth/login",
                json={
                    "email": recipient_email,
                    "password": password,
                    "device_name": "transport-recipient",
                },
            )
        ).status_code == 200

        sender_sessions = await sender_client.get("/v1/sessions")
        recipient_sessions = await recipient_client.get("/v1/sessions")
        sender_device = uuid.UUID(
            next(item["id"] for item in sender_sessions.json() if item["current"])
        )
        recipient_device = uuid.UUID(
            next(item["id"] for item in recipient_sessions.json() if item["current"])
        )

        assert (
            await sender_client.put(
                f"/v1/e2ee/devices/{sender_device}",
                json={
                    "identity_public_key_b64": base64.b64encode(b"T" * 32).decode()
                },
            )
        ).status_code == 204
        assert (
            await recipient_client.put(
                f"/v1/e2ee/devices/{recipient_device}",
                json={
                    "identity_public_key_b64": base64.b64encode(b"U" * 32).decode()
                },
            )
        ).status_code == 204

        created = await sender_client.post(
            "/v1/conversations",
            json={
                "type": "direct",
                "title": None,
                "member_ids": [str(recipient_id)],
                "encryption_required": True,
            },
        )
        assert created.status_code == 201, created.text
        conversation_id = created.json()["id"]
        premature = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/activate"
        )
        assert premature.status_code == 409, premature.text

        bootstrap_welcome = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-events",
            json={
                "client_id": str(uuid.uuid4()),
                "sender_device_id": str(sender_device),
                "kind": "welcome",
                "payload_b64": base64.b64encode(b"opaque-bootstrap-welcome").decode(),
                "recipients": [
                    {
                        "user_id": str(recipient_id),
                        "device_id": str(recipient_device),
                    }
                ],
            },
        )
        assert bootstrap_welcome.status_code == 201, bootstrap_welcome.text

        activated = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/activate"
        )
        assert activated.status_code == 204, activated.text

        def envelope(label: str) -> dict:
            return {
                "version": 1,
                "protocol": "mls-rfc9420",
                "kind": "application",
                "ciphertext": base64.b64encode(label.encode()).decode(),
            }

        first = await sender_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": envelope("old-epoch"),
                "asset_ids": [],
            },
        )
        assert first.status_code == 201, first.text

        control = await sender_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-events",
            json={
                "client_id": str(uuid.uuid4()),
                "sender_device_id": str(sender_device),
                "kind": "commit",
                "payload_b64": base64.b64encode(b"opaque-commit").decode(),
                "recipients": [
                    {
                        "user_id": str(recipient_id),
                        "device_id": str(recipient_device),
                    }
                ],
            },
        )
        assert control.status_code == 201, control.text

        second = await sender_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": envelope("new-epoch"),
                "asset_ids": [],
            },
        )
        assert second.status_code == 201, second.text

        feed = await recipient_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{recipient_device}/transport-events"
        )
        assert feed.status_code == 200, feed.text
        items = feed.json()
        assert [item["kind"] for item in items] == [
            "mls_control",
            "message",
            "mls_control",
            "message",
        ]
        assert [item["transport_sequence"] for item in items] == [1, 2, 3, 4]
        assert items[0]["control"]["id"] == bootstrap_welcome.json()["id"]
        assert items[1]["message_id"] == first.json()["id"]
        assert items[2]["control"]["id"] == control.json()["id"]
        assert items[3]["message_id"] == second.json()["id"]

        after_two = await recipient_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{recipient_device}/transport-events?after=2"
        )
        assert after_two.status_code == 200
        assert [item["transport_sequence"] for item in after_two.json()] == [3, 4]


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
async def test_e2ee_membership_prepare_allows_old_epoch_until_control_delivery() -> None:
    suffix = uuid.uuid4().hex[:10]
    owner_email = f"phase-owner-{suffix}@example.com"
    member_email = f"phase-member-{suffix}@example.com"
    target_email = f"phase-target-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        owner = User(
            email=owner_email,
            display_name="Phase Owner",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        member = User(
            email=member_email,
            display_name="Phase Member",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        target = User(
            email=target_email,
            display_name="Phase Target",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([owner, member, target])
        await db.commit()
        await db.refresh(member)
        await db.refresh(target)
        member_id = member.id
        target_id = target.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as owner_client, httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as target_client:
        assert (
            await owner_client.post(
                "/v1/auth/login",
                json={
                    "email": owner_email,
                    "password": password,
                    "device_name": "phase-owner-device",
                },
            )
        ).status_code == 200
        assert (
            await target_client.post(
                "/v1/auth/login",
                json={
                    "email": target_email,
                    "password": password,
                    "device_name": "phase-target-device",
                },
            )
        ).status_code == 200

        owner_sessions = await owner_client.get("/v1/sessions")
        target_sessions = await target_client.get("/v1/sessions")
        owner_device = uuid.UUID(
            next(item["id"] for item in owner_sessions.json() if item["current"])
        )
        target_device = uuid.UUID(
            next(item["id"] for item in target_sessions.json() if item["current"])
        )

        assert (
            await owner_client.put(
                f"/v1/e2ee/devices/{owner_device}",
                json={
                    "identity_public_key_b64": base64.b64encode(
                        hashlib.sha256(str(owner_device).encode()).digest()
                    ).decode()
                },
            )
        ).status_code == 204
        assert (
            await target_client.put(
                f"/v1/e2ee/devices/{target_device}",
                json={
                    "identity_public_key_b64": base64.b64encode(
                        hashlib.sha256(str(target_device).encode()).digest()
                    ).decode()
                },
            )
        ).status_code == 204

        created = await owner_client.post(
            "/v1/conversations",
            json={
                "type": "group",
                "title": "Phase Group",
                "member_ids": [str(member_id)],
                "encryption_required": True,
            },
        )
        assert created.status_code == 201, created.text
        conversation_id = created.json()["id"]

        # This test isolates an already-active group. Initial bootstrap activation
        # coverage is exercised by the dedicated Welcome/device integration test.
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

        def encrypted_payload(label: str) -> dict:
            return {
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "mls-rfc9420",
                    "kind": "application",
                    "ciphertext": base64.b64encode(label.encode()).decode(),
                },
                "asset_ids": [],
            }

        before_prepare = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json=encrypted_payload("before-prepare"),
        )
        assert before_prepare.status_code == 201, before_prepare.text

        prepared = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/membership-changes/add/{target_id}"
        )
        assert prepared.status_code == 201, prepared.text
        change_id = prepared.json()["id"]

        # A prepared transition has not changed the MLS epoch yet. Existing
        # members may still deliver old-epoch application ciphertext.
        before_commit = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json=encrypted_payload("before-commit"),
        )
        assert before_commit.status_code == 201, before_commit.text

        control = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json={
                "sender_device_id": str(owner_device),
                "membership_change_id": change_id,
                "events": [
                    {
                        "client_id": str(uuid.uuid4()),
                        "kind": "welcome",
                        "payload_b64": base64.b64encode(b"opaque-mls-welcome").decode(),
                        "recipients": [
                            {
                                "user_id": str(target_id),
                                "device_id": str(target_device),
                            }
                        ],
                    }
                ],
            },
        )
        assert control.status_code == 201, control.text

        after_commit = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json=encrypted_payload("after-commit"),
        )
        assert after_commit.status_code == 409, after_commit.text


@pytest.mark.asyncio(loop_scope="session")
async def test_e2ee_device_add_and_revoke_require_durable_rekey() -> None:
    suffix = uuid.uuid4().hex[:10]
    password = "correct horse battery staple"
    owner_email = f"device-owner-{suffix}@example.com"
    peer_email = f"device-peer-{suffix}@example.com"

    async with SessionFactory() as db:
        owner = User(
            email=owner_email,
            display_name="Device Owner",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        peer = User(
            email=peer_email,
            display_name="Device Peer",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([owner, peer])
        await db.commit()
        await db.refresh(peer)
        peer_id = peer.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS
    ) as owner_client, httpx.AsyncClient(
        transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS
    ) as peer_old_client, httpx.AsyncClient(
        transport=transport, base_url=ORIGIN, headers=MUTATION_HEADERS
    ) as peer_new_client:
        for client, email, device_name in [
            (owner_client, owner_email, "owner-device"),
            (peer_old_client, peer_email, "peer-old-device"),
        ]:
            login = await client.post(
                "/v1/auth/login",
                json={
                    "email": email,
                    "password": password,
                    "device_name": device_name,
                },
            )
            assert login.status_code == 200, login.text

        owner_device = next(
            item["id"]
            for item in (await owner_client.get("/v1/sessions")).json()
            if item["current"]
        )
        peer_old_device = next(
            item["id"]
            for item in (await peer_old_client.get("/v1/sessions")).json()
            if item["current"]
        )

        for client, device_id, marker in [
            (owner_client, owner_device, b"O"),
            (peer_old_client, peer_old_device, b"P"),
        ]:
            registered = await client.put(
                f"/v1/e2ee/devices/{device_id}",
                json={
                    "identity_public_key_b64": base64.b64encode(marker * 32).decode()
                },
            )
            assert registered.status_code == 204, registered.text
            published = await client.put(
                f"/v1/e2ee/devices/{device_id}/key-packages",
                json={
                    "device_id": device_id,
                    "key_packages_b64": [
                        base64.b64encode(marker + uuid.uuid4().bytes).decode()
                    ],
                },
            )
            assert published.status_code == 204, published.text

        created = await owner_client.post(
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

        initial_welcome = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-events",
            json={
                "client_id": str(uuid.uuid4()),
                "sender_device_id": owner_device,
                "kind": "welcome",
                "payload_b64": base64.b64encode(b"initial-device-welcome").decode(),
                "recipients": [
                    {
                        "user_id": str(peer_id),
                        "device_id": peer_old_device,
                    }
                ],
            },
        )
        assert initial_welcome.status_code == 201, initial_welcome.text
        activated = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/activate"
        )
        assert activated.status_code == 204, activated.text

        new_login = await peer_new_client.post(
            "/v1/auth/login",
            json={
                "email": peer_email,
                "password": password,
                "device_name": "peer-new-device",
            },
        )
        assert new_login.status_code == 200, new_login.text
        peer_new_device = next(
            item["id"]
            for item in (await peer_new_client.get("/v1/sessions")).json()
            if item["current"]
        )
        registered_new = await peer_new_client.put(
            f"/v1/e2ee/devices/{peer_new_device}",
            json={
                "identity_public_key_b64": base64.b64encode(b"N" * 32).decode()
            },
        )
        assert registered_new.status_code == 204, registered_new.text
        published_new = await peer_new_client.put(
            f"/v1/e2ee/devices/{peer_new_device}/key-packages",
            json={
                "device_id": peer_new_device,
                "key_packages_b64": [
                    base64.b64encode(b"N" + uuid.uuid4().bytes).decode()
                ],
            },
        )
        assert published_new.status_code == 204, published_new.text

        pending_add = await owner_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/membership-changes/pending"
        )
        assert pending_add.status_code == 200, pending_add.text
        add_change = pending_add.json()["change"]
        assert add_change["kind"] == "device_add"
        assert add_change["target_device_id"] == peer_new_device
        assert pending_add.json()["target_device"]["active"] is True

        # New-device add does not expose the old epoch to the new device, so
        # old-epoch application delivery may finish before the first MLS control.
        before_add_control = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "mls-rfc9420",
                    "kind": "application",
                    "ciphertext": base64.b64encode(b"before-device-add").decode(),
                },
                "asset_ids": [],
            },
        )
        assert before_add_control.status_code == 201, before_add_control.text

        add_control = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json={
                "sender_device_id": owner_device,
                "membership_change_id": add_change["id"],
                "events": [
                    {
                        "client_id": str(uuid.uuid4()),
                        "kind": "commit",
                        "payload_b64": base64.b64encode(b"device-add-commit").decode(),
                        "recipients": [
                            {
                                "user_id": str(peer_id),
                                "device_id": peer_old_device,
                            }
                        ],
                    },
                    {
                        "client_id": str(uuid.uuid4()),
                        "kind": "welcome",
                        "payload_b64": base64.b64encode(b"device-add-welcome").decode(),
                        "recipients": [
                            {
                                "user_id": str(peer_id),
                                "device_id": peer_new_device,
                            }
                        ],
                    },
                ],
            },
        )
        assert add_control.status_code == 201, add_control.text
        add_finalized = await owner_client.post(
            f"/v1/e2ee/membership-changes/{add_change['id']}/finalize"
        )
        assert add_finalized.status_code == 204, add_finalized.text

        revoked = await peer_new_client.delete(
            f"/v1/sessions/{peer_old_device}"
        )
        assert revoked.status_code == 204, revoked.text

        blocked = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "mls-rfc9420",
                    "kind": "application",
                    "ciphertext": base64.b64encode(b"must-not-use-old-epoch").decode(),
                },
                "asset_ids": [],
            },
        )
        assert blocked.status_code == 409, blocked.text

        pending_remove = await owner_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/membership-changes/pending"
        )
        assert pending_remove.status_code == 200, pending_remove.text
        remove_change = pending_remove.json()["change"]
        assert remove_change["kind"] == "device_remove"
        assert remove_change["target_device_id"] == peer_old_device
        assert pending_remove.json()["target_device"]["active"] is False

        remove_control = await owner_client.post(
            f"/v1/e2ee/conversations/{conversation_id}/control-batches",
            json={
                "sender_device_id": owner_device,
                "membership_change_id": remove_change["id"],
                "events": [
                    {
                        "client_id": str(uuid.uuid4()),
                        "kind": "commit",
                        "payload_b64": base64.b64encode(b"device-remove-commit").decode(),
                        "recipients": [
                            {
                                "user_id": str(peer_id),
                                "device_id": peer_new_device,
                            }
                        ],
                    }
                ],
            },
        )
        assert remove_control.status_code == 201, remove_control.text
        remove_finalized = await owner_client.post(
            f"/v1/e2ee/membership-changes/{remove_change['id']}/finalize"
        )
        assert remove_finalized.status_code == 204, remove_finalized.text

        after_remove = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "mls-rfc9420",
                    "kind": "application",
                    "ciphertext": base64.b64encode(b"after-device-remove").decode(),
                },
                "asset_ids": [],
            },
        )
        assert after_remove.status_code == 201, after_remove.text
