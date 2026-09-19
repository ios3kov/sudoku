from functools import lru_cache

import boto3

from .config import get_settings


def _make_client(endpoint_url: str | None):
    settings = get_settings()
    kwargs = {
        "service_name": "s3",
        "region_name": settings.s3_region,
        "endpoint_url": endpoint_url,
    }
    if settings.s3_access_key_id and settings.s3_secret_access_key:
        kwargs["aws_access_key_id"] = settings.s3_access_key_id
        kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
    return boto3.client(**kwargs)


@lru_cache
def s3_client():
    """Internal object-store client used for verification/deletion."""
    return _make_client(get_settings().s3_endpoint_url)


@lru_cache
def s3_presign_client():
    """Signing client whose endpoint must be reachable by the browser."""
    settings = get_settings()
    return _make_client(settings.s3_public_endpoint_url or settings.s3_endpoint_url)
