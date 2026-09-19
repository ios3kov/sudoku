"""E2EE server boundary

Revision ID: 0006_e2ee_boundary
Revises: 0005_conversation_preferences
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision="0006_e2ee_boundary"
down_revision="0005_conversation_preferences"
branch_labels=None
depends_on=None

def upgrade():
    op.add_column("conversations",sa.Column("encryption_required",sa.Boolean(),nullable=False,server_default=sa.false()))
    op.alter_column("conversations","encryption_required",server_default=None)
    op.add_column("messages",sa.Column("envelope",postgresql.JSONB(),nullable=True))
    op.create_table(
        "device_key_bundles",
        sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),
        sa.Column("user_id",postgresql.UUID(as_uuid=True),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),
        sa.Column("device_id",postgresql.UUID(as_uuid=True),nullable=False),
        sa.Column("protocol",sa.String(32),nullable=False),
        sa.Column("identity_key",sa.LargeBinary(),nullable=False),
        sa.Column("signed_prekey",sa.LargeBinary(),nullable=False),
        sa.Column("signed_prekey_signature",sa.LargeBinary(),nullable=False),
        sa.Column("one_time_prekeys",postgresql.JSONB(),nullable=False),
        sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column("revoked_at",sa.DateTime(timezone=True),nullable=True),
        sa.UniqueConstraint("user_id","device_id",name="uq_device_key_user_device"),
    )
    op.create_index("ix_device_key_bundles_user_active","device_key_bundles",["user_id","revoked_at"])

def downgrade():
    op.drop_index("ix_device_key_bundles_user_active",table_name="device_key_bundles")
    op.drop_table("device_key_bundles")
    op.drop_column("messages","envelope")
    op.drop_column("conversations","encryption_required")
