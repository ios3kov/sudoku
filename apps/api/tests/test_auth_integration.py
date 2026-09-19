import os
os.environ.setdefault("DATABASE_URL","postgresql+asyncpg://sudoku:sudoku@localhost:5432/sudoku")
os.environ.setdefault("REDIS_URL","redis://localhost:6379/0")
import pytest
from httpx import ASGITransport,AsyncClient
from sqlalchemy import delete
from app.db import SessionLocal
from app.main import app
from app.models import Invite,Session,User
from app.security import hash_password
@pytest.mark.asyncio
async def test_login_session_list_and_revoke():
    async with SessionLocal() as db:
        await db.execute(delete(Invite));await db.execute(delete(Session));await db.execute(delete(User));db.add(User(email="admin@example.com",display_name="Admin",password_hash=hash_password("very-secure-password"),is_admin=True));await db.commit()
    transport=ASGITransport(app=app)
    async with AsyncClient(transport=transport,base_url="http://test") as c:
        r=await c.post("/v1/auth/login",json={"email":"admin@example.com","password":"very-secure-password","device_name":"CI"})
        assert r.status_code==200
        me=await c.get("/v1/me");assert me.status_code==200 and me.json()["is_admin"] is True
        sessions=await c.get("/v1/sessions");assert sessions.status_code==200 and len(sessions.json())==1
        sid=sessions.json()[0]["id"];rev=await c.delete(f"/v1/sessions/{sid}");assert rev.status_code==200
        assert (await c.get("/v1/me")).status_code==401
