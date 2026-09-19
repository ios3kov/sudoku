import base64
import hashlib
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db import SessionFactory
from app.main import app
from app.models import Invite, User
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
        cid=created.json()["id"]
        plaintext=await client.post(f"/v1/conversations/{cid}/messages",json={"client_id":str(uuid.uuid4()),"type":"text","body":"secret plaintext","asset_ids":[]})
        assert plaintext.status_code==422
        envelope={"version":1,"protocol":"test-envelope","ciphertext":"AAECAwQ="}
        encrypted=await client.post(f"/v1/conversations/{cid}/messages",json={"client_id":str(uuid.uuid4()),"type":"text","body":None,"envelope":envelope,"asset_ids":[]})
        assert encrypted.status_code==201,encrypted.text
        assert encrypted.json()["body"] is None
        assert encrypted.json()["envelope"]==envelope
        search=await client.get(f"/v1/conversations/{cid}/search?q=secret")
        assert search.status_code==409
    async with SessionFactory() as db:
        from app.models import Message
        row=(await db.execute(select(Message).where(Message.conversation_id==uuid.UUID(cid)))).scalar_one()
        assert row.body_text is None
        assert row.envelope==envelope


@pytest.mark.asyncio(loop_scope="session")
async def test_mls_key_packages_are_single_use_and_replay_protected() -> None:
    suffix = uuid.uuid4().hex[:10]
    email = f"mls-{suffix}@example.com"
    password = "correct horse battery staple"
    device_id = uuid.uuid4()

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
        assert replay.status_code == 409

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
    sender_device = uuid.uuid4()
    recipient_device = uuid.uuid4()

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
