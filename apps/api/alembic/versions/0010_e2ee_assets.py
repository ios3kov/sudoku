"""E2EE ciphertext asset marker

Revision ID: 0010_e2ee_assets
Revises: 0009_mls_control_transport
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_e2ee_assets"
down_revision = "0009_mls_control_transport"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assets",
        sa.Column(
            "e2ee_ciphertext",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("assets", "e2ee_ciphertext", server_default=None)


def downgrade() -> None:
    op.drop_column("assets", "e2ee_ciphertext")
