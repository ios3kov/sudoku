"""add sender device provenance to message transport events

Revision ID: 0019_transport_sender_device
Revises: 0018_session_biometrics
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019_transport_sender_device"
down_revision = "0018_session_biometrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_transport_events",
        sa.Column(
            "sender_device_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("conversation_transport_events", "sender_device_id")
