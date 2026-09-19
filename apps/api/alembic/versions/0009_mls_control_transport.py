"""MLS device registry and control transport

Revision ID: 0009_mls_control_transport
Revises: 0008_mls_key_packages
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_mls_control_transport"
down_revision = "0008_mls_key_packages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "next_crypto_sequence",
            sa.BigInteger(),
            nullable=False,
            server_default="1",
        ),
    )
    op.alter_column("conversations", "next_crypto_sequence", server_default=None)

    op.create_table(
        "mls_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("identity_public_key", sa.LargeBinary(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "device_id", name="uq_mls_device_user_device"),
        sa.UniqueConstraint("identity_public_key", name="uq_mls_device_identity_key"),
    )
    op.create_index(
        "ix_mls_devices_user_active",
        "mls_devices",
        ["user_id", "revoked_at"],
    )

    op.create_table(
        "mls_control_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("sender_device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "sender_user_id",
            "sender_device_id",
            "client_id",
            name="uq_mls_control_sender_client",
        ),
        sa.UniqueConstraint(
            "conversation_id",
            "sequence",
            name="uq_mls_control_conversation_sequence",
        ),
    )
    op.create_index(
        "ix_mls_control_conversation_sequence",
        "mls_control_events",
        ["conversation_id", "sequence"],
    )

    op.create_table(
        "mls_control_recipients",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("mls_control_events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("acked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_mls_control_recipient_pending",
        "mls_control_recipients",
        ["user_id", "device_id", "acked_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mls_control_recipient_pending",
        table_name="mls_control_recipients",
    )
    op.drop_table("mls_control_recipients")
    op.drop_index(
        "ix_mls_control_conversation_sequence",
        table_name="mls_control_events",
    )
    op.drop_table("mls_control_events")
    op.drop_index("ix_mls_devices_user_active", table_name="mls_devices")
    op.drop_table("mls_devices")
    op.drop_column("conversations", "next_crypto_sequence")
