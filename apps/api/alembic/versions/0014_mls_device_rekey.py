"""Track device-scoped MLS rekey transitions

Revision ID: 0014_mls_device_rekey
Revises: 0013_e2ee_membership_changes
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014_mls_device_rekey"
down_revision = "0013_e2ee_membership_changes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_membership_changes",
        sa.Column("target_device_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversation_membership_changes", "target_device_id")
