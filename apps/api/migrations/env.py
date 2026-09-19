import asyncio
from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from app.config import settings
from app.models import Base
config=context.config
target_metadata=Base.metadata
def offline():
    context.configure(url=settings.database_url,target_metadata=target_metadata,literal_binds=True,dialect_opts={"paramstyle":"named"})
    with context.begin_transaction():context.run_migrations()
async def online():
    engine=create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        await conn.run_sync(lambda c: context.configure(connection=c,target_metadata=target_metadata))
        await conn.run_sync(lambda c: context.run_migrations())
    await engine.dispose()
if context.is_offline_mode():offline()
else:asyncio.run(online())
