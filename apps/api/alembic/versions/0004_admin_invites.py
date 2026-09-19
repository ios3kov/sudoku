"""admin flag for controlled invite issuance

Revision ID: 0004_admin_invites
Revises: 0003_assets_push
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_admin_invites"
down_revision = "0003_assets_push"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("users", "is_admin", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "is_admin")
