"""Resolve an authorized media URL without redirecting an unlock header to S3."""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import AuthContext, get_auth_context
from .assets import DOWNLOAD_TTL_SECONDS, asset_content

router = APIRouter(prefix="/v1/assets", tags=["assets"])


@router.get("/{asset_id}/download-url")
async def asset_download_url(
    asset_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    # Reuse the same membership/ownership checks and signature construction.
    response = await asset_content(asset_id=asset_id, auth=auth, db=db)
    return {"url": response.headers["location"], "expires_in": DOWNLOAD_TTL_SECONDS}
