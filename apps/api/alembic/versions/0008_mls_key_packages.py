"""replace Signal-style prekeys with MLS KeyPackages

Revision ID: 0008_mls_key_packages
Revises: 0007_atomic_prekeys
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008_mls_key_packages"
down_revision = "0007_atomic_prekeys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mls_key_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("package_ref", sa.LargeBinary(length=32), nullable=False),
        sa.Column("key_package", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("package_ref", name="uq_mls_key_package_ref"),
    )
    op.create_index(
        "ix_mls_key_packages_claim",
        "mls_key_packages",
        ["user_id", "device_id", "claimed_at", "created_at"],
    )

    op.drop_index("ix_device_prekeys_claim", table_name="device_one_time_prekeys")
    op.drop_table("device_one_time_prekeys")
    op.drop_index("ix_device_key_bundles_user_active", table_name="device_key_bundles")
    op.drop_table("device_key_bundles")


def downgrade() -> None:
    op.create_table(
        "device_key_bundles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("protocol", sa.String(32), nullable=False),
        sa.Column("identity_key", sa.LargeBinary(), nullable=False),
        sa.Column("signed_prekey", sa.LargeBinary(), nullable=False),
        sa.Column("signed_prekey_signature", sa.LargeBinary(), nullable=False),
        sa.Column("one_time_prekeys", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "device_id", name="uq_device_key_user_device"),
    )
    op.create_index(
        "ix_device_key_bundles_user_active",
        "device_key_bundles",
        ["user_id", "revoked_at"],
    )

    op.create_table(
        "device_one_time_prekeys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "user_id", "device_id", "key_id", name="uq_device_prekey_identity"
        ),
    )
    op.create_index(
        "ix_device_prekeys_claim",
        "device_one_time_prekeys",
        ["user_id", "device_id", "consumed_at", "created_at"],
    )

    op.drop_index("ix_mls_key_packages_claim", table_name="mls_key_packages")
    op.drop_table("mls_key_packages")
