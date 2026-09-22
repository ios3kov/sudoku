"""Add optional per-session device PIN locks.

Revision ID: 0015_session_pins
Revises: 0014_mls_device_rekey
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_session_pins"
down_revision = "0014_mls_device_rekey"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_pins",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("pin_hash", sa.String(512), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unlock_hash", sa.LargeBinary(32), nullable=True),
        sa.Column("unlock_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 5", name="ck_session_pin_attempts"),
    )


def downgrade() -> None:
    op.drop_table("session_pins")
