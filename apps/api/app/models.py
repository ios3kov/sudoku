import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase): pass
class User(Base):
    __tablename__="users"
    id:Mapped[uuid.UUID]=mapped_column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4)
    email:Mapped[str]=mapped_column(String(320),unique=True,index=True)
    display_name:Mapped[str]=mapped_column(String(120))
    password_hash:Mapped[str]=mapped_column(String(512))
    is_admin:Mapped[bool]=mapped_column(Boolean,default=False)
    active:Mapped[bool]=mapped_column(Boolean,default=True)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now())
class Session(Base):
    __tablename__="sessions"
    id:Mapped[uuid.UUID]=mapped_column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4)
    user_id:Mapped[uuid.UUID]=mapped_column(ForeignKey("users.id",ondelete="CASCADE"),index=True)
    token_hash:Mapped[bytes]=mapped_column(LargeBinary(32),unique=True,index=True)
    device_name:Mapped[str]=mapped_column(String(160))
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),index=True)
    revoked_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now())
class Invite(Base):
    __tablename__="invites"
    id:Mapped[uuid.UUID]=mapped_column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4)
    token_hash:Mapped[bytes]=mapped_column(LargeBinary(32),unique=True,index=True)
    email:Mapped[str|None]=mapped_column(String(320),nullable=True)
    created_by:Mapped[uuid.UUID]=mapped_column(ForeignKey("users.id",ondelete="CASCADE"))
    expires_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),index=True)
    used_at:Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
