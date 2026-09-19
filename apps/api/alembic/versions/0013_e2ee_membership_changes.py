"""E2EE membership transition choreography

Revision ID: 0013_e2ee_membership_changes
Revises: 0012_e2ee_ready
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013_e2ee_membership_changes"
down_revision = "0012_e2ee_ready"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column(
            "e2ee_state",
            sa.String(length=24),
            nullable=False,
            server_default="active",
        ),
    )
    op.alter_column("conversation_members", "e2ee_state", server_default=None)

    op.create_table(
        "conversation_membership_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_conversation_membership_change_pending",
        "conversation_membership_changes",
        ["conversation_id", "status", "created_at"],
    )

    op.add_column(
        "mls_control_events",
        sa.Column(
            "membership_change_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversation_membership_changes.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_mls_control_membership_change",
        "mls_control_events",
        ["membership_change_id", "kind"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mls_control_membership_change",
        table_name="mls_control_events",
    )
    op.drop_column("mls_control_events", "membership_change_id")
    op.drop_index(
        "ix_conversation_membership_change_pending",
        table_name="conversation_membership_changes",
    )
    op.drop_table("conversation_membership_changes")
    op.drop_column("conversation_members", "e2ee_state")
