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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_e2ee_conversation_rejects_plaintext_and_stores_envelope_only() -> None:
    suffix=uuid.uuid4().hex[:10]
    email=f"e2ee-{suffix}@example.com"
    password="correct horse battery staple"
    async with SessionFactory() as db:
        user=User(email=email,display_name="E2EE",password_hash=hash_password(password),status="active",is_admin=False)
        db.add(user);await db.commit()
    transport=httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport,base_url=ORIGIN,headers=MUTATION_HEADERS) as client:
        assert (await client.post("/v1/auth/login",json={"email":email,"password":password,"device_name":"e2ee-test"})).status_code==200
        created=await client.post("/v1/conversations",json={"type":"group","title":"Encrypted","member_ids":[],"encryption_required":True})
        assert created.status_code==201,created.text
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
