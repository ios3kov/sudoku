"""CI-only PostgreSQL dump/restore plus object-byte recovery; never production."""
import hashlib
import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("This drill only runs against disposable GitHub CI services")
    container = os.environ["AUDIT_POSTGRES_CONTAINER"]
    restored_db = "audit_restore_" + uuid.uuid4().hex

    def pg(*args, data=None):
        return subprocess.run(["docker", "exec", "-i", container, *args], input=data,
                              capture_output=True, check=True).stdout

    def sql(database, statement):
        return pg("psql", "-U", "sudoku", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", statement).decode().strip()

    def snapshot(database):
        tables = sql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
        return {table: int(sql(database, 'SELECT count(*) FROM "' + table.replace('"', '""') + '"')) for table in tables}

    def s3(port, access, secret):
        return boto3.client("s3", endpoint_url=f"http://127.0.0.1:{port}", region_name="us-east-1",
                            aws_access_key_id=access, aws_secret_access_key=secret)

    source = s3(9000, "sudoku-ci", "sudoku-ci-secret")
    target = s3(19000, "audit-local", "audit-local-secret")
    source_bucket, target_bucket = "sudoku-assets", "restore-audit-" + uuid.uuid4().hex
    keys = []
    created_db = created_bucket = False
    probe_key = "restore-probe-" + uuid.uuid4().hex
    cipher = AESGCM(AESGCM.generate_key(bit_length=256))
    nonce, plaintext = os.urandom(12), os.urandom(65536)
    ciphertext = cipher.encrypt(nonce, plaintext, None)
    source.put_object(Bucket=source_bucket, Key=probe_key, Body=ciphertext,
                      ContentType="application/octet-stream", Metadata={"e2ee": "1"})
    try:
        with tempfile.TemporaryDirectory(prefix="sudoku-restore-audit-") as directory:
            root = Path(directory)
            rows_before = snapshot("sudoku")
            version_before = sql("sudoku", "SELECT version_num FROM alembic_version ORDER BY version_num")
            dump = pg("pg_dump", "-U", "sudoku", "-d", "sudoku", "--format=custom", "--no-owner", "--no-acl")
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
                    manifest.append((item["Key"], file, hashlib.sha256(data).hexdigest(), obj["ContentType"], obj["Metadata"]))
            started = time.perf_counter()
            sql("postgres", f'CREATE DATABASE "{restored_db}" OWNER sudoku')
            created_db = True
            pg("pg_restore", "-U", "sudoku", "-d", restored_db, "--no-owner", "--no-acl",
               "--single-transaction", "--exit-on-error", data=(root / "postgres.dump").read_bytes())
            target.create_bucket(Bucket=target_bucket)
            created_bucket = True
            for key, file, digest, content_type, metadata in manifest:
                data = file.read_bytes()
                assert hashlib.sha256(data).hexdigest() == digest
                target.put_object(Bucket=target_bucket, Key=key, Body=data, ContentType=content_type, Metadata=metadata)
                keys.append(key)
                obj = target.get_object(Bucket=target_bucket, Key=key)
                try:
                    recovered = obj["Body"].read()
                    assert hashlib.sha256(recovered).hexdigest() == digest
                    if key == probe_key:
                        assert cipher.decrypt(nonce, recovered, None) == plaintext
                finally:
                    obj["Body"].close()
                assert obj["Metadata"] == metadata and obj["ContentType"] == content_type
            assert snapshot(restored_db) == rows_before
            assert sql(restored_db, "SELECT version_num FROM alembic_version ORDER BY version_num") == version_before
            report = {"sourceSha": os.environ.get("AUDIT_SOURCE_SHA"), "databaseTables": len(rows_before),
                      "rows": sum(rows_before.values()), "objects": len(manifest),
                      "objectBytes": sum(file.stat().st_size for _, file, *_ in manifest),
                      "dumpBytes": len(dump), "recoveryAndVerificationSeconds": round(time.perf_counter() - started, 3),
                      "result": "passed", "scope": "Disposable CI DB schema/row counts and synthetic object hashes/metadata; not production RTO/RPO or app login after restore"}
            Path("audit-performance").mkdir(exist_ok=True)
            Path("audit-performance/restore.json").write_text(json.dumps(report, indent=2) + "\n")
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
