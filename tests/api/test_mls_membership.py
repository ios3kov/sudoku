import base64
import hashlib
import uuid

import httpx
import pytest
from app.db import SessionFactory
from app.main import app
from app.models import (
    Conversation,
    ConversationMember,
    ConversationMembershipChange,
    User,
)
from app.security import hash_password
from sqlalchemy import select

ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}

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

        before_welcome_feed = await peer_new_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{peer_new_device}/transport-events"
        )
        assert before_welcome_feed.status_code == 200, before_welcome_feed.text
        assert before_welcome_feed.json() == []

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

        after_add_message = await owner_client.post(
            f"/v1/conversations/{conversation_id}/messages",
            json={
                "client_id": str(uuid.uuid4()),
                "type": "text",
                "body": None,
                "envelope": {
                    "version": 1,
                    "protocol": "mls-rfc9420",
                    "kind": "application",
                    "ciphertext": base64.b64encode(b"after-device-add").decode(),
                },
                "asset_ids": [],
            },
        )
        assert after_add_message.status_code == 201, after_add_message.text

        after_welcome_feed = await peer_new_client.get(
            f"/v1/e2ee/conversations/{conversation_id}/devices/{peer_new_device}/transport-events"
        )
        assert after_welcome_feed.status_code == 200, after_welcome_feed.text
        assert [item["kind"] for item in after_welcome_feed.json()] == [
            "mls_control",
            "message",
        ]
        assert after_welcome_feed.json()[0]["control"]["kind"] == "welcome"
        assert after_welcome_feed.json()[1]["message_id"] == after_add_message.json()["id"]
        assert all(
            item.get("message_id") != before_add_control.json()["id"]
            for item in after_welcome_feed.json()
        )

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


@pytest.mark.asyncio(loop_scope="session")
async def test_unrelated_user_cannot_finalize_device_rekey() -> None:
    suffix = uuid.uuid4().hex[:10]
    owner_email = f"rekey-owner-{suffix}@example.com"
    outsider_email = f"rekey-outsider-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        owner = User(
            email=owner_email,
            display_name="Rekey Owner",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        outsider = User(
            email=outsider_email,
            display_name="Rekey Outsider",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add_all([owner, outsider])
        await db.flush()

        conversation = Conversation(
            type="group",
            title="Private Rekey",
            created_by=owner.id,
            next_sequence=1,
            encryption_required=True,
            e2ee_ready=True,
        )
        db.add(conversation)
        await db.flush()
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=owner.id,
                role="owner",
                e2ee_state="active",
            )
        )
        change = ConversationMembershipChange(
            conversation_id=conversation.id,
            target_user_id=owner.id,
            target_device_id=uuid.uuid4(),
            requested_by=owner.id,
            kind="device_add",
            status="pending",
        )
        db.add(change)
        await db.commit()
        conversation_id = conversation.id
        change_id = change.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers=MUTATION_HEADERS,
    ) as outsider_client:
        login = await outsider_client.post(
            "/v1/auth/login",
            json={
                "email": outsider_email,
                "password": password,
                "device_name": "outsider-device",
            },
        )
        assert login.status_code == 200, login.text

        response = await outsider_client.post(
            f"/v1/e2ee/membership-changes/{change_id}/finalize"
        )
        assert response.status_code == 403, response.text

    async with SessionFactory() as db:
        stored = await db.get(ConversationMembershipChange, change_id)
        assert stored is not None
        assert stored.conversation_id == conversation_id
        assert stored.status == "pending"
