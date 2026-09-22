import argparse
import asyncio
import json
import statistics
import time
import uuid

import httpx
from app.db import SessionFactory
from app.models import Conversation, ConversationMember


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--requests", type=int, default=1000)
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--soak-seconds", type=int, default=60)
    args = parser.parse_args()

    async with httpx.AsyncClient(base_url=args.base_url, timeout=10) as client:
        response = await client.post(
            "/v1/auth/login",
            headers={"Origin": "http://127.0.0.1:3000"},
            json={
                "email": "browser-owner@example.com",
                "password": "browser acceptance password",
                "device_name": "load-profile",
            },
        )
        response.raise_for_status()
        user_id = uuid.UUID(response.json()["id"])

        # Exercise a realistically large conversation list without consuming
        # public API create-rate limits. The CI database is disposable.
        async with SessionFactory() as db:
            for index in range(200):
                conversation = Conversation(
                    type="group",
                    title=f"Load profile {index:03d}",
                    created_by=user_id,
                    encryption_required=True,
                    e2ee_ready=True,
                )
                db.add(conversation)
                await db.flush()
                db.add(ConversationMember(
                    conversation_id=conversation.id,
                    user_id=user_id,
                    role="owner",
                    e2ee_state="active",
                ))
            await db.commit()

        latencies: list[float] = []
        errors: list[int] = []
        semaphore = asyncio.Semaphore(args.concurrency)

        async def one() -> None:
            async with semaphore:
                started = time.perf_counter()
                item = await client.get("/v1/conversations")
                latencies.append((time.perf_counter() - started) * 1000)
                if item.status_code != 200:
                    errors.append(item.status_code)

        started = time.perf_counter()
        await asyncio.gather(*(one() for _ in range(args.requests)))
        elapsed = time.perf_counter() - started
        latencies.sort()
        p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)]
        p99 = latencies[max(0, int(len(latencies) * 0.99) - 1)]
        print(json.dumps({
            "phase": "load",
            "requests": len(latencies),
            "errors": len(errors),
            "elapsed_s": round(elapsed, 3),
            "rps": round(len(latencies) / elapsed, 1),
            "p50_ms": round(statistics.median(latencies), 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
        }, sort_keys=True))
        if errors or p95 > 500:
            raise SystemExit("load budget failed")

        stop = time.monotonic() + args.soak_seconds
        soak_count = 0
        soak_errors = 0
        soak_latencies: list[float] = []

        async def soak_worker() -> None:
            nonlocal soak_count, soak_errors
            while time.monotonic() < stop:
                started = time.perf_counter()
                try:
                    item = await client.get("/v1/conversations")
                    soak_errors += int(item.status_code != 200)
                except httpx.HTTPError:
                    soak_errors += 1
                soak_latencies.append((time.perf_counter() - started) * 1000)
                soak_count += 1
                await asyncio.sleep(0.2)

        await asyncio.gather(*(soak_worker() for _ in range(5)))
        soak_latencies.sort()
        soak_p95 = soak_latencies[max(0, int(len(soak_latencies) * 0.95) - 1)]
        print(json.dumps({
            "phase": "soak",
            "seconds": args.soak_seconds,
            "requests": soak_count,
            "errors": soak_errors,
            "p95_ms": round(soak_p95, 2),
        }, sort_keys=True))
        if soak_errors or soak_p95 > 500:
            raise SystemExit("soak budget failed")


if __name__ == "__main__":
    asyncio.run(main())
