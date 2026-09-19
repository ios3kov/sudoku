from collections.abc import Hashable

from fastapi import HTTPException, status
from redis.asyncio import Redis

from .config import get_settings

_redis = Redis.from_url(get_settings().redis_url, decode_responses=False)


async def _enforce_fixed_window(key: str, limit: int, ttl_seconds: int) -> None:
    count = await _redis.incr(key)
    if count == 1:
        await _redis.expire(key, ttl_seconds)
    if count > limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")


async def enforce_login_rate_limit(ip: str, email: str) -> None:
    # Two independent buckets reduce both account-targeted brute force and single-IP floods.
    await _enforce_fixed_window(f"rl:login:ip:{ip}", 30, 300)
    await _enforce_fixed_window(f"rl:login:email:{email}", 10, 900)


async def enforce_user_rate_limit(user_id: Hashable, action: str, limit: int, ttl_seconds: int) -> None:
    await _enforce_fixed_window(f"rl:user:{user_id}:{action}", limit, ttl_seconds)


async def enforce_ip_rate_limit(ip: str, action: str, limit: int, ttl_seconds: int) -> None:
    await _enforce_fixed_window(f"rl:ip:{ip}:{action}", limit, ttl_seconds)
