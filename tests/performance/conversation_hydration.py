"""Paired real-PostgreSQL comparison of the old/new authenticated list body.

The immutable old function is loaded from Git, not reimplemented for the result.
Synthetic data only. SQL counts exclude authentication and fixture creation.
This is a DB/serialization microprofile, not an HTTP throughput measurement.
"""
import ast
import asyncio
import hashlib
import json
import os
import statistics
import subprocess
import time
import uuid
from types import SimpleNamespace
from urllib.parse import urlsplit

from app.db import SessionFactory, engine
from app.models import Conversation, ConversationMember, User
from app.routes import messaging
from sqlalchemy import delete, event

BASELINE = "ec557c2827b0d2b5329425016df3dfa8ddaf4f71"


def load_baseline():
    source = subprocess.check_output([
        "git", "show", f"{BASELINE}:apps/api/app/routes/messaging.py",
    ], text=True)
    module = ast.parse(source)
    node = next(item for item in module.body
                if isinstance(item, ast.AsyncFunctionDef) and item.name == "list_conversations")
    node.decorator_list = []
    # Both functions use identical serializers/models; the batch option defaults
    # to the original per-conversation query when the old function calls it.
    scope = dict(vars(messaging))
    exec(compile(ast.Module(body=[node], type_ignores=[]), "baseline-list", "exec"), scope)
    return scope["list_conversations"], hashlib.sha256(source.encode()).hexdigest()


def digest(responses):
    rows = sorted((item.model_dump(mode="json") for item in responses), key=lambda row: row["id"])
    return hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()


async def main():
    host = urlsplit(os.environ.get("DATABASE_URL", "")).hostname
    if os.environ.get("SUDOKU_DISPOSABLE_PROFILE") != "YES" or host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("This mutating profile requires an explicitly disposable loopback database")
    baseline, source_sha256 = load_baseline()
    run = uuid.uuid4().hex
    user_ids = []
    conversation_ids = []
    samples = {"before": [], "after": []}
    queries = {"before": [], "after": []}
    try:
        async with SessionFactory() as db:
            users = [User(email=f"{role}-{run}@example.test", display_name=role,
                          password_hash="unused-profile-only", status="active")
                     for role in ("Owner", "Peer", "Pending")]
            db.add_all(users)
            await db.flush()
            user_ids = [u.id for u in users]
            owner = users[0]
            for i in range(200):
                conversation = Conversation(type="group", title=f"Profile {i}", created_by=owner.id,
                                            encryption_required=True, e2ee_ready=True)
                db.add(conversation)
                await db.flush()
                conversation_ids.append(conversation.id)
                db.add_all([ConversationMember(conversation_id=conversation.id, user_id=u.id,
                            role="owner" if n == 0 else "member",
                            e2ee_state="pending_add" if n == 2 else "active") for n, u in enumerate(users)])
            await db.commit()

        expected = None
        # Pair order reverses each time to reduce systematic warm-cache bias.
        for repeat in range(12):
            for label in (("before", "after") if repeat % 2 == 0 else ("after", "before")):
                fn = baseline if label == "before" else messaging.list_conversations
                count = 0

                def record_query(*_):
                    nonlocal count
                    count += 1

                async with SessionFactory() as db:
                    event.listen(engine.sync_engine, "before_cursor_execute", record_query)
                    try:
                        started = time.perf_counter()
                        responses = await fn(auth=SimpleNamespace(user=owner), db=db)
                        duration = (time.perf_counter() - started) * 1000
                    finally:
                        event.remove(engine.sync_engine, "before_cursor_execute", record_query)
                assert len(responses) == 200
                assert all(len(item.members) == 2 for item in responses), "pending members leaked"
                current = digest(responses)
                if expected is None:
                    expected = current
                assert current == expected, "the two implementations returned different data"
                if repeat >= 2:
                    samples[label].append(duration)
                    queries[label].append(count)
        assert set(queries["before"]) == {201}
        assert set(queries["after"]) == {2}, "conversation-list N+1 query regression"
        result = {
            "profile": "paired-postgresql-conversation-list",
            "baseline_sha": BASELINE,
            "baseline_source_sha256": source_sha256,
            "candidate_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
            "conversations": 200, "members_each": 2, "excluded_pending_each": 1,
            "samples_each": 10, "warmup_pairs": 2, "responses_identical": True,
            "before": {"queries": 201, "median_ms": round(statistics.median(samples["before"]), 3),
                       "samples_ms": [round(v, 3) for v in samples["before"]]},
            "after": {"queries": 2, "median_ms": round(statistics.median(samples["after"]), 3),
                      "samples_ms": [round(v, 3) for v in samples["after"]]},
        }
        print(json.dumps(result, sort_keys=True))
    finally:
        async with SessionFactory() as db:
            if conversation_ids:
                await db.execute(delete(Conversation).where(Conversation.id.in_(conversation_ids)))
            if user_ids:
                await db.execute(delete(User).where(User.id.in_(user_ids)))
            await db.commit()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
