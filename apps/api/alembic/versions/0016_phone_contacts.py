"""Add phone identities and server-enforced contact graph.

Revision ID: 0016_phone_contacts
Revises: 0015_session_pins
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_phone_contacts"
down_revision = "0015_session_pins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_e164", sa.String(16), nullable=True))
    op.add_column("users", sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=True)
    op.create_unique_constraint("uq_users_phone_e164", "users", ["phone_e164"])

    op.add_column("invites", sa.Column("phone_e164", sa.String(16), nullable=True))
    op.alter_column(
        "login_attempts",
        "email_hash",
        new_column_name="identifier_hash",
        existing_type=sa.LargeBinary(32),
        existing_nullable=False,
    )

    op.create_table(
        "user_contacts",
        sa.Column(
            "owner_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "contact_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "owner_user_id <> contact_user_id",
            name="ck_user_contact_not_self",
        ),
    )
    op.create_index(
        "ix_user_contacts_contact",
        "user_contacts",
        ["contact_user_id", "owner_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_contacts_contact", table_name="user_contacts")
    op.drop_table("user_contacts")
    op.alter_column(
        "login_attempts",
        "identifier_hash",
        new_column_name="email_hash",
        existing_type=sa.LargeBinary(32),
        existing_nullable=False,
    )
    op.drop_column("invites", "phone_e164")
    op.drop_constraint("uq_users_phone_e164", "users", type_="unique")
    op.alter_column("users", "email", existing_type=sa.String(320), nullable=False)
    op.drop_column("users", "phone_verified_at")
    op.drop_column("users", "phone_e164")
