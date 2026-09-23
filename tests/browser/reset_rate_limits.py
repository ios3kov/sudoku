import asyncio

from app.config import get_settings
from redis.asyncio import Redis


async def main() -> None:
    redis = Redis.from_url(get_settings().redis_url, decode_responses=False)
    try:
        keys = [key async for key in redis.scan_iter(match="rl:*", count=500)]
        if keys:
            await redis.delete(*keys)
        print(f"BROWSER_RATE_LIMIT_RESET={len(keys)}")
    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
