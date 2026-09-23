import os
import subprocess
import uuid
from datetime import UTC, datetime, timedelta

import psycopg


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
API_DIR = os.path.join(ROOT, "apps", "api")


def alembic(*args: str) -> None:
    subprocess.run(["alembic", *args], cwd=API_DIR, check=True)


def database_url() -> str:
    raw = os.environ["DATABASE_URL"]
    return raw.replace("postgresql+asyncpg://", "postgresql://", 1)


def main() -> None:
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    invite_id = uuid.uuid4()
    attempt_id = uuid.uuid4()

    alembic("upgrade", "0015_session_pins")

    with psycopg.connect(database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users
                    (id, email, display_name, password_hash, status, is_admin)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    "legacy-migration@example.com",
                    "Legacy Migration",
                    "$argon2id$legacy-test-hash",
                    "active",
                    True,
                ),
            )
            cursor.execute(
                """
                INSERT INTO sessions
                    (id, user_id, token_hash, device_name, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    user_id,
                    b"s" * 32,
                    "legacy-device",
                    datetime.now(UTC) + timedelta(days=30),
                ),
            )
            cursor.execute(
                """
                INSERT INTO session_pins
                    (session_id, pin_hash, failed_attempts, unlock_hash, unlock_expires_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    "$argon2id$legacy-pin-hash",
                    2,
                    b"u" * 32,
                    datetime.now(UTC) + timedelta(hours=1),
                ),
            )
            cursor.execute(
                """
                INSERT INTO invites
                    (id, token_hash, email, created_by, expires_at, max_uses, uses)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    invite_id,
                    b"i" * 32,
                    "invite-target@example.com",
                    user_id,
                    datetime.now(UTC) + timedelta(days=7),
                    1,
                    0,
                ),
            )
            cursor.execute(
                """
                INSERT INTO login_attempts
                    (id, email_hash, succeeded)
                VALUES (%s, %s, %s)
                """,
                (attempt_id, b"h" * 32, 1),
            )
        connection.commit()

    alembic("upgrade", "0016_phone_contacts")

    with psycopg.connect(database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT email, phone_e164, phone_verified_at, is_admin
                FROM users
                WHERE id = %s
                """,
                (user_id,),
            )
            user = cursor.fetchone()
            assert user == ("legacy-migration@example.com", None, None, True), user

            cursor.execute(
                """
                SELECT user_id, device_name
                FROM sessions
                WHERE id = %s
                """,
                (session_id,),
            )
            session = cursor.fetchone()
            assert session == (user_id, "legacy-device"), session

            cursor.execute(
                """
                SELECT failed_attempts, unlock_hash
                FROM session_pins
                WHERE session_id = %s
                """,
                (session_id,),
            )
            pin = cursor.fetchone()
            assert pin == (2, b"u" * 32), pin

            cursor.execute(
                """
                SELECT email, phone_e164
                FROM invites
                WHERE id = %s
                """,
                (invite_id,),
            )
            invite = cursor.fetchone()
            assert invite == ("invite-target@example.com", None), invite

            cursor.execute(
                """
                SELECT identifier_hash, succeeded
                FROM login_attempts
                WHERE id = %s
                """,
                (attempt_id,),
            )
            attempt = cursor.fetchone()
            assert attempt == (b"h" * 32, 1), attempt

            cursor.execute("SELECT count(*) FROM user_contacts")
            assert cursor.fetchone() == (0,)

            cursor.execute(
                """
                SELECT version_num
                FROM alembic_version
                """
            )
            assert cursor.fetchone() == ("0016_phone_contacts",)

    alembic("downgrade", "base")
    print("PHONE_MIGRATION_UPGRADE_OK")


if __name__ == "__main__":
    main()
