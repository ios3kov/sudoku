"""E2EE conversation activation gate

Revision ID: 0012_e2ee_ready
Revises: 0011_transport_ledger
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_e2ee_ready"
down_revision = "0011_transport_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "e2ee_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.alter_column("conversations", "e2ee_ready", server_default=None)


def downgrade() -> None:
    op.drop_column("conversations", "e2ee_ready")
