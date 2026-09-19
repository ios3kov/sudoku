"""per-member conversation preferences

Revision ID: 0005_conversation_preferences
Revises: 0004_admin_invites
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_conversation_preferences"
down_revision = "0004_admin_invites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "conversation_members",
        sa.Column("notifications_muted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("conversation_members", "is_pinned", server_default=None)
    op.alter_column("conversation_members", "notifications_muted", server_default=None)


def downgrade() -> None:
    op.drop_column("conversation_members", "notifications_muted")
    op.drop_column("conversation_members", "is_pinned")
