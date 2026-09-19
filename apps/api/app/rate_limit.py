import time
from fastapi import HTTPException
from redis.asyncio import Redis
from .config import settings
redis=Redis.from_url(settings.redis_url,decode_responses=True)
async def limit(bucket:str,key:str,max_requests:int,window_seconds:int)->None:
    slot=int(time.time()//window_seconds)
    redis_key=f"rl:{bucket}:{slot}:{key}"
    count=await redis.incr(redis_key)
    if count==1:await redis.expire(redis_key,window_seconds+2)
    if count>max_requests:raise HTTPException(429,"Too many requests")
