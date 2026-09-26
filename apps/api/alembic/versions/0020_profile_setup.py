"""track display-name onboarding completion

Revision ID: 0020_profile_setup
Revises: 0019_transport_sender_device
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_profile_setup"
down_revision = "0019_transport_sender_device"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "profile_setup_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "profile_setup_completed")
