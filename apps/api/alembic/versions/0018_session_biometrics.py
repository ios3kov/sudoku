"""Add session-bound native biometric credentials.

Revision ID: 0018_session_biometrics
Revises: 0017_single_admin
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018_session_biometrics"
down_revision = "0017_single_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_biometric_credentials",
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("public_key_x963", sa.LargeBinary(length=65), nullable=False),
        sa.Column("challenge_hash", sa.LargeBinary(length=32), nullable=True),
        sa.Column("challenge_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("session_biometric_credentials")
