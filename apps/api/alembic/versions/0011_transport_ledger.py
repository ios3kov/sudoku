"""Unified conversation transport ledger

Revision ID: 0011_transport_ledger
Revises: 0010_e2ee_assets
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_transport_ledger"
down_revision = "0010_e2ee_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "next_transport_sequence",
            sa.BigInteger(),
            nullable=False,
            server_default="1",
        ),
    )
    op.alter_column(
        "conversations",
        "next_transport_sequence",
        server_default=None,
    )

    op.create_table(
        "conversation_transport_events",
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sequence", sa.BigInteger(), primary_key=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column(
            "message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "control_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("mls_control_events.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "conversation_id",
            "sequence",
            name="uq_conversation_transport_sequence",
        ),
        sa.UniqueConstraint(
            "message_id",
            name="uq_conversation_transport_message",
        ),
        sa.UniqueConstraint(
            "control_event_id",
            name="uq_conversation_transport_control",
        ),
        sa.CheckConstraint(
            "(message_id IS NOT NULL) <> (control_event_id IS NOT NULL)",
            name="ck_conversation_transport_exactly_one_ref",
        ),
    )
    op.create_index(
        "ix_conversation_transport_sequence",
        "conversation_transport_events",
        ["conversation_id", "sequence"],
    )

    op.execute(
        """
        WITH combined AS (
            SELECT conversation_id, id AS ref_id, 'message'::text AS kind, created_at
            FROM messages
            UNION ALL
            SELECT conversation_id, id AS ref_id, 'mls_control'::text AS kind, created_at
            FROM mls_control_events
        ),
        ranked AS (
            SELECT
                conversation_id,
                ref_id,
                kind,
                created_at,
                row_number() OVER (
                    PARTITION BY conversation_id
                    ORDER BY created_at, kind, ref_id
                ) AS transport_sequence
            FROM combined
        )
        INSERT INTO conversation_transport_events (
            conversation_id,
            sequence,
            kind,
            message_id,
            control_event_id,
            created_at
        )
        SELECT
            conversation_id,
            transport_sequence,
            kind,
            CASE WHEN kind = 'message' THEN ref_id ELSE NULL END,
            CASE WHEN kind = 'mls_control' THEN ref_id ELSE NULL END,
            created_at
        FROM ranked
        """
    )
    op.execute(
        """
        UPDATE conversations AS c
        SET next_transport_sequence = COALESCE(
            (
                SELECT MAX(t.sequence) + 1
                FROM conversation_transport_events AS t
                WHERE t.conversation_id = c.id
            ),
            1
        )
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_conversation_transport_sequence",
        table_name="conversation_transport_events",
    )
    op.drop_table("conversation_transport_events")
    op.drop_column("conversations", "next_transport_sequence")
