"""auth tables"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision="0001_auth";down_revision=None
def upgrade():
    op.create_table("users",sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),sa.Column("email",sa.String(320),nullable=False),sa.Column("display_name",sa.String(120),nullable=False),sa.Column("password_hash",sa.String(512),nullable=False),sa.Column("is_admin",sa.Boolean(),nullable=False,server_default=sa.false()),sa.Column("active",sa.Boolean(),nullable=False,server_default=sa.true()),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.UniqueConstraint("email"))
    op.create_index("ix_users_email","users",["email"],unique=True)
    op.create_table("sessions",sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),sa.Column("user_id",postgresql.UUID(as_uuid=True),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),sa.Column("token_hash",sa.LargeBinary(32),nullable=False),sa.Column("device_name",sa.String(160),nullable=False),sa.Column("expires_at",sa.DateTime(timezone=True),nullable=False),sa.Column("revoked_at",sa.DateTime(timezone=True)),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.UniqueConstraint("token_hash"))
    op.create_index("ix_sessions_user_id","sessions",["user_id"]);op.create_index("ix_sessions_token_hash","sessions",["token_hash"],unique=True);op.create_index("ix_sessions_expires_at","sessions",["expires_at"])
    op.create_table("invites",sa.Column("id",postgresql.UUID(as_uuid=True),primary_key=True),sa.Column("token_hash",sa.LargeBinary(32),nullable=False),sa.Column("email",sa.String(320)),sa.Column("created_by",postgresql.UUID(as_uuid=True),sa.ForeignKey("users.id",ondelete="CASCADE"),nullable=False),sa.Column("expires_at",sa.DateTime(timezone=True),nullable=False),sa.Column("used_at",sa.DateTime(timezone=True)),sa.UniqueConstraint("token_hash"))
    op.create_index("ix_invites_token_hash","invites",["token_hash"],unique=True);op.create_index("ix_invites_expires_at","invites",["expires_at"])
def downgrade():
    op.drop_table("invites");op.drop_table("sessions");op.drop_table("users")
