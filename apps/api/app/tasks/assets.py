from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, create_engine, exists, or_, select
from sqlalchemy.orm import Session as SyncSession

from ..config import get_settings
from ..metrics import record_assets_cleaned
from ..models import Asset, MessageAsset
from ..storage import s3_client
from ..worker import celery_app

settings = get_settings()
sync_db_url = settings.database_url.replace("+asyncpg", "+psycopg")
engine = create_engine(sync_db_url, pool_pre_ping=True, pool_size=3, max_overflow=5)


@celery_app.task(
    name="app.tasks.assets.cleanup_orphan_assets",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 5},
)
def cleanup_orphan_assets(max_age_hours: int = 24, batch_size: int = 200) -> int:
    """Delete stale upload objects and unlinked ready assets.

    S3 deletion happens before the DB row is removed. S3 DELETE is idempotent, so a
    database failure can safely be retried without leaking a storage object.
    """
    cutoff = datetime.now(UTC) - timedelta(hours=max_age_hours)
    linked = exists(select(MessageAsset.asset_id).where(MessageAsset.asset_id == Asset.id))
    with SyncSession(engine) as db:
        assets = (
            db.execute(
                select(Asset)
                .where(
                    Asset.created_at < cutoff,
                    or_(
                        Asset.status.in_(["pending", "rejected"]),
                        and_(Asset.status == "ready", ~linked),
                    ),
                )
                .order_by(Asset.created_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()

        for asset in assets:
            s3_client().delete_object(Bucket=settings.s3_bucket, Key=asset.storage_key)
            db.delete(asset)
        db.commit()
        record_assets_cleaned(len(assets))
        return len(assets)
