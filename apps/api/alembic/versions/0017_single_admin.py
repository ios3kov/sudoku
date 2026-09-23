"""Enforce a single administrator account.

Revision ID: 0017_single_admin
Revises: 0016_phone_contacts
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_single_admin"
down_revision = "0016_phone_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    admin_count = int(
        bind.execute(sa.text("SELECT count(*) FROM users WHERE is_admin IS TRUE")).scalar_one()
    )
    if admin_count > 1:
        raise RuntimeError(
            "Refusing migration: more than one administrator account exists"
        )

    op.create_index(
        "uq_users_single_admin",
        "users",
        ["is_admin"],
        unique=True,
        postgresql_where=sa.text("is_admin IS TRUE"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_single_admin", table_name="users")
