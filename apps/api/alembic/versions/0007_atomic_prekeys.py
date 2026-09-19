"""atomic one-time prekeys

Revision ID: 0007_atomic_prekeys
Revises: 0006_e2ee_boundary
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision="0007_atomic_prekeys"
down_revision="0006_e2ee_boundary"
branch_labels=None
depends_on=None

def upgrade():
    op.create_table(
        "device_one_time_prekeys",
        sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),
        sa.Column("user_id",postgresql.UUID(as_uuid=True),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("device_id",postgresql.UUID(as_uuid=True),nullable=False),
        sa.Column("key_id",postgresql.UUID(as_uuid=True),nullable=False),
        sa.Column("public_key",sa.LargeBinary(),nullable=False),
        sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column("consumed_at",sa.DateTime(timezone=True),nullable=True),
        sa.UniqueConstraint("user_id","device_id","key_id",name="uq_device_prekey_identity"),
    )
    op.create_index(
        "ix_device_prekeys_claim",
        "device_one_time_prekeys",
        ["user_id","device_id","consumed_at","created_at"],
    )

def downgrade():
    op.drop_index("ix_device_prekeys_claim",table_name="device_one_time_prekeys")
    op.drop_table("device_one_time_prekeys")
