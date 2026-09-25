"""Exercise restored application state through the real FastAPI routes."""
import asyncio
import hashlib
import json
import os

import httpx
from app.main import app


async def main() -> None:
    origin = os.environ["PUBLIC_ORIGIN"]
    phone = os.environ["RESTORE_AUDIT_PHONE"]
    password = os.environ["RESTORE_AUDIT_PASSWORD"]
    conversation_id = os.environ["RESTORE_AUDIT_CONVERSATION_ID"]
    message_id = os.environ["RESTORE_AUDIT_MESSAGE_ID"]
    asset_id = os.environ["RESTORE_AUDIT_ASSET_ID"]
    expected_asset_sha256 = os.environ["RESTORE_AUDIT_ASSET_SHA256"]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url=origin,
        headers={"origin": origin},
    ) as client:
        login = await client.post(
            "/v1/auth/login",
            json={
                "phone": phone,
                "password": password,
                "device_name": "restore-application-probe",
            },
        )
        assert login.status_code == 200, login.text

        conversations = await client.get("/v1/conversations")
        assert conversations.status_code == 200, conversations.text
        restored_conversation = next(
            item for item in conversations.json() if item["id"] == conversation_id
        )
        assert restored_conversation["encryption_required"] is True
        assert restored_conversation["e2ee_ready"] is True

        messages = await client.get(
            f"/v1/conversations/{conversation_id}/messages?after=0&limit=50"
        )
        assert messages.status_code == 200, messages.text
        restored_message = next(
            item for item in messages.json() if item["id"] == message_id
        )
        assert restored_message["body"] is None
        assert restored_message["envelope"]["protocol"] == "restore-audit"
        assert restored_message["assets"][0]["id"] == asset_id
        assert restored_message["assets"][0]["e2ee_ciphertext"] is True

        asset = await client.get(f"/v1/assets/{asset_id}")
        assert asset.status_code == 200, asset.text
        assert asset.json()["e2ee_ciphertext"] is True
        assert asset.json()["sha256_hex"] == expected_asset_sha256

        content = await client.get(
            f"/v1/assets/{asset_id}/content",
            follow_redirects=False,
        )
        assert content.status_code == 302, content.text
        location = content.headers["location"]

    async with httpx.AsyncClient() as storage:
        recovered = await storage.get(location)
        assert recovered.status_code == 200, recovered.text
        assert hashlib.sha256(recovered.content).hexdigest() == expected_asset_sha256

    print(
        json.dumps(
            {
                "login": "passed",
                "conversation": conversation_id,
                "message": message_id,
                "asset": asset_id,
                "encryptedAssetDownload": "passed",
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
