import pytest
from sqlalchemy import text
from app.db import engine

@pytest.mark.asyncio
async def test_required_auth_tables_exist_after_migration():
    async with engine.connect() as conn:
        rows=(await conn.execute(text("select tablename from pg_tables where schemaname='public'"))).scalars().all()
    assert {"alembic_version","users","sessions","invites"}.issubset(set(rows))
