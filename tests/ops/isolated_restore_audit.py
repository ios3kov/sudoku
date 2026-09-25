"""CI-only PostgreSQL/object restore with an application-level recovery probe."""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import boto3
from app.db import SessionFactory
from app.models import (
    Asset,
    Conversation,
    ConversationMember,
    Message,
    MessageAsset,
    User,
)
from app.security import hash_password
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


async def seed_application_fixture(storage_key: str, ciphertext: bytes) -> dict[str, str]:
    phone = "+1555" + str(uuid.uuid4().int % 10_000_000).zfill(7)
    password = "restore-audit-" + uuid.uuid4().hex
    now = datetime.now(UTC)

    async with SessionFactory() as db:
        user = User(
            phone_e164=phone,
            phone_verified_at=now,
            display_name="Restore Audit",
            password_hash=hash_password(password),
            status="active",
            is_admin=False,
        )
        db.add(user)
        await db.flush()

        conversation = Conversation(
            type="group",
            title="Restore audit",
            created_by=user.id,
            next_sequence=2,
            next_crypto_sequence=1,
            next_transport_sequence=1,
            encryption_required=True,
            e2ee_ready=True,
        )
        db.add(conversation)
        await db.flush()
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user.id,
                role="owner",
                e2ee_state="active",
            )
        )

        asset = Asset(
            owner_id=user.id,
            storage_key=storage_key,
            filename="encrypted.bin",
            mime_type="application/octet-stream",
            size_bytes=len(ciphertext),
            sha256=hashlib.sha256(ciphertext).digest(),
            e2ee_ciphertext=True,
            status="ready",
            ready_at=now,
        )
        db.add(asset)
        await db.flush()

        message = Message(
            conversation_id=conversation.id,
            sender_id=user.id,
            client_id=uuid.uuid4(),
            sequence=1,
            type="file",
            body_text=None,
            envelope={
                "version": 1,
                "protocol": "restore-audit",
                "kind": "application",
                "ciphertext": "synthetic-restore-audit-envelope",
            },
            encryption_version=1,
        )
        db.add(message)
        await db.flush()
        db.add(MessageAsset(message_id=message.id, asset_id=asset.id, position=0))
        await db.commit()

        return {
            "phone": phone,
            "password": password,
            "conversation_id": str(conversation.id),
            "message_id": str(message.id),
            "asset_id": str(asset.id),
            "asset_sha256": hashlib.sha256(ciphertext).hexdigest(),
        }


def run_application_probe(restored_db: str, target_bucket: str, fixture: dict[str, str]) -> None:
    env = {
        **os.environ,
        "DATABASE_URL": f"postgresql+asyncpg://sudoku:sudoku-ci@127.0.0.1:5432/{restored_db}",
        "PUBLIC_ORIGIN": "https://sudoku.test",
        "SESSION_COOKIE_NAME": "sudoku_session",
        "SESSION_TTL_DAYS": "30",
        "SECURE_COOKIES": "true",
        "REQUIRE_E2EE_NEW_CONVERSATIONS": "true",
        "S3_BUCKET": target_bucket,
        "S3_REGION": "us-east-1",
        "S3_ENDPOINT_URL": "http://127.0.0.1:19000",
        "S3_PUBLIC_ENDPOINT_URL": "http://127.0.0.1:19000",
        "S3_ACCESS_KEY_ID": "audit-local",
        "S3_SECRET_ACCESS_KEY": "audit-local-secret",
        "RESTORE_AUDIT_PHONE": fixture["phone"],
        "RESTORE_AUDIT_PASSWORD": fixture["password"],
        "RESTORE_AUDIT_CONVERSATION_ID": fixture["conversation_id"],
        "RESTORE_AUDIT_MESSAGE_ID": fixture["message_id"],
        "RESTORE_AUDIT_ASSET_ID": fixture["asset_id"],
        "RESTORE_AUDIT_ASSET_SHA256": fixture["asset_sha256"],
    }
    probe = subprocess.run(
        [sys.executable, "tests/ops/restore_application_probe.py"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    if probe.stdout:
        print(probe.stdout, end="")
    if probe.returncode != 0:
        if probe.stderr:
            print(probe.stderr, file=sys.stderr, end="")
        raise RuntimeError("restored application probe failed")


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("This drill only runs against disposable GitHub CI services")
    container = os.environ["AUDIT_POSTGRES_CONTAINER"]
    restored_db = "audit_restore_" + uuid.uuid4().hex

    def pg(*args, data=None):
        return subprocess.run(
            ["docker", "exec", "-i", container, *args],
            input=data,
            capture_output=True,
            check=True,
        ).stdout

    def sql(database, statement):
        return pg(
            "psql",
            "-U",
            "sudoku",
            "-d",
            database,
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            statement,
        ).decode().strip()

    def snapshot(database):
        tables = sql(
            database,
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        ).splitlines()
        return {
            table: int(
                sql(
                    database,
                    'SELECT count(*) FROM "' + table.replace('"', '""') + '"',
                )
            )
            for table in tables
        }

    def s3(port, access, secret):
        return boto3.client(
            "s3",
            endpoint_url=f"http://127.0.0.1:{port}",
            region_name="us-east-1",
            aws_access_key_id=access,
            aws_secret_access_key=secret,
        )

    source = s3(9000, "sudoku-ci", "sudoku-ci-secret")
    target = s3(19000, "audit-local", "audit-local-secret")
    source_bucket = "sudoku-assets"
    target_bucket = "restore-audit-" + uuid.uuid4().hex
    keys = []
    created_db = created_bucket = False
    probe_key = "restore-probe-" + uuid.uuid4().hex
    cipher = AESGCM(AESGCM.generate_key(bit_length=256))
    nonce, plaintext = os.urandom(12), os.urandom(65536)
    ciphertext = cipher.encrypt(nonce, plaintext, None)
    source.put_object(
        Bucket=source_bucket,
        Key=probe_key,
        Body=ciphertext,
        ContentType="application/octet-stream",
        Metadata={"e2ee": "1"},
    )
    fixture = asyncio.run(seed_application_fixture(probe_key, ciphertext))

    try:
        with tempfile.TemporaryDirectory(prefix="sudoku-restore-audit-") as directory:
            root = Path(directory)
            rows_before = snapshot("sudoku")
            version_before = sql(
                "sudoku",
                "SELECT version_num FROM alembic_version ORDER BY version_num",
            )
            dump = pg(
                "pg_dump",
                "-U",
                "sudoku",
                "-d",
                "sudoku",
                "--format=custom",
                "--no-owner",
                "--no-acl",
            )
            (root / "postgres.dump").write_bytes(dump)
            manifest = []
            for page in source.get_paginator("list_objects_v2").paginate(Bucket=source_bucket):
                for item in page.get("Contents", []):
                    obj = source.get_object(Bucket=source_bucket, Key=item["Key"])
                    try:
                        data = obj["Body"].read()
                    finally:
                        obj["Body"].close()
                    file = root / f"object-{len(manifest)}"
                    file.write_bytes(data)
                    manifest.append(
                        (
                            item["Key"],
                            file,
                            hashlib.sha256(data).hexdigest(),
                            obj["ContentType"],
                            obj["Metadata"],
                        )
                    )

            started = time.perf_counter()
            sql("postgres", f'CREATE DATABASE "{restored_db}" OWNER sudoku')
            created_db = True
            pg(
                "pg_restore",
                "-U",
                "sudoku",
                "-d",
                restored_db,
                "--no-owner",
                "--no-acl",
                "--single-transaction",
                "--exit-on-error",
                data=(root / "postgres.dump").read_bytes(),
            )
            target.create_bucket(Bucket=target_bucket)
            created_bucket = True

            for key, file, digest, content_type, metadata in manifest:
                data = file.read_bytes()
                assert hashlib.sha256(data).hexdigest() == digest
                target.put_object(
                    Bucket=target_bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                    Metadata=metadata,
                )
                keys.append(key)
                obj = target.get_object(Bucket=target_bucket, Key=key)
                try:
                    recovered = obj["Body"].read()
                    assert hashlib.sha256(recovered).hexdigest() == digest
                    if key == probe_key:
                        assert cipher.decrypt(nonce, recovered, None) == plaintext
                finally:
                    obj["Body"].close()
                assert obj["Metadata"] == metadata
                assert obj["ContentType"] == content_type

            assert snapshot(restored_db) == rows_before
            assert (
                sql(
                    restored_db,
                    "SELECT version_num FROM alembic_version ORDER BY version_num",
                )
                == version_before
            )

            run_application_probe(restored_db, target_bucket, fixture)

            report = {
                "sourceSha": os.environ.get("AUDIT_SOURCE_SHA"),
                "databaseTables": len(rows_before),
                "rows": sum(rows_before.values()),
                "objects": len(manifest),
                "objectBytes": sum(file.stat().st_size for _, file, *_ in manifest),
                "dumpBytes": len(dump),
                "applicationProbe": {
                    "login": "passed",
                    "conversation": "passed",
                    "message": "passed",
                    "encryptedAssetDownload": "passed",
                },
                "recoveryAndVerificationSeconds": round(
                    time.perf_counter() - started,
                    3,
                ),
                "result": "passed",
                "scope": (
                    "Disposable CI database plus synthetic E2EE application fixture; "
                    "verifies login, conversation/message recovery and signed encrypted "
                    "asset download after restore. Not production RTO/RPO or a restore "
                    "of real production backup bytes."
                ),
            }
            Path("audit-performance").mkdir(exist_ok=True)
            Path("audit-performance/restore.json").write_text(
                json.dumps(report, indent=2) + "\n",
                encoding="utf-8",
            )
            print(json.dumps(report))
    finally:
        source.delete_object(Bucket=source_bucket, Key=probe_key)
        if created_bucket:
            for key in keys:
                target.delete_object(Bucket=target_bucket, Key=key)
            target.delete_bucket(Bucket=target_bucket)
        if created_db:
            sql("postgres", f'DROP DATABASE "{restored_db}" WITH (FORCE)')


if __name__ == "__main__":
    main()
