import asyncio
import base64
import hashlib
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db import SessionFactory
from app.main import app
from app.models import (
    ConversationMember,
    User,
)
from app.security import hash_password


ORIGIN = "https://sudoku.test"
MUTATION_HEADERS = {"origin": ORIGIN}

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
async def test_concurrent_mls_device_registration_is_idempotent() -> None:
    suffix = uuid.uuid4().hex[:10]
    email = f"mls-register-race-{suffix}@example.com"
    password = "correct horse battery staple"

    async with SessionFactory() as db:
        user = User(
            email=email,
            display_name="MLS Register Race",
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
                "device_name": "registration-race",
            },
        )
        assert login.status_code == 200, login.text

        sessions = await client.get("/v1/sessions")
        assert sessions.status_code == 200, sessions.text
        device_id = next(item["id"] for item in sessions.json() if item["current"])
        identity = base64.b64encode(hashlib.sha256(suffix.encode()).digest()).decode()

        responses = await asyncio.gather(*[
            client.put(
                f"/v1/e2ee/devices/{device_id}",
                json={"identity_public_key_b64": identity},
            )
            for _ in range(6)
        ])
        assert [response.status_code for response in responses] == [204] * 6

    async with SessionFactory() as db:
        from app.models import MlsDevice

        rows = (
            await db.execute(
                select(MlsDevice).where(MlsDevice.device_id == uuid.UUID(device_id))
            )
        ).scalars().all()
        assert len(rows) == 1
