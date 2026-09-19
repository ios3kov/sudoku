from datetime import datetime,timedelta,timezone
from fastapi import APIRouter,Cookie,Depends,HTTPException,Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .config import settings
from .db import get_db
from .models import Invite,Session,User
from .schemas import InviteAcceptIn,InviteCreateIn,LoginIn,UserOut
from .security import hash_password,new_token,token_digest,verify_password
router=APIRouter(prefix="/v1")
def now():return datetime.now(timezone.utc)
async def current_user(session_token:str|None=Cookie(default=None,alias=settings.session_cookie),db:AsyncSession=Depends(get_db)):
    if not session_token:raise HTTPException(401,"Authentication required")
    row=await db.execute(select(User).join(Session,Session.user_id==User.id).where(Session.token_hash==token_digest(session_token),Session.revoked_at.is_(None),Session.expires_at>now(),User.active.is_(True)))
    user=row.scalar_one_or_none()
    if not user:raise HTTPException(401,"Authentication required")
    return user
async def issue_session(db,user,device):
    raw=new_token();db.add(Session(user_id=user.id,token_hash=token_digest(raw),device_name=device,expires_at=now()+timedelta(days=settings.session_days)));await db.commit();return raw
def set_cookie(response,raw):response.set_cookie(settings.session_cookie,raw,httponly=True,secure=settings.secure_cookies,samesite="lax",max_age=settings.session_days*86400,path="/")
@router.get("/me",response_model=UserOut)
async def me(user:User=Depends(current_user)):return UserOut(id=str(user.id),email=user.email,display_name=user.display_name,is_admin=user.is_admin)
@router.post("/auth/login")
async def login(body:LoginIn,response:Response,db:AsyncSession=Depends(get_db)):
    user=(await db.execute(select(User).where(User.email==str(body.email).lower(),User.active.is_(True)))).scalar_one_or_none()
    if not user or not verify_password(user.password_hash,body.password):raise HTTPException(401,"Invalid credentials")
    raw=await issue_session(db,user,body.device_name);set_cookie(response,raw);return {"ok":True}
@router.post("/auth/logout")
async def logout(response:Response,session_token:str|None=Cookie(default=None,alias=settings.session_cookie),db:AsyncSession=Depends(get_db)):
    if session_token:
        s=(await db.execute(select(Session).where(Session.token_hash==token_digest(session_token),Session.revoked_at.is_(None)))).scalar_one_or_none()
        if s:s.revoked_at=now();await db.commit()
    response.delete_cookie(settings.session_cookie,path="/");return {"ok":True}
@router.post("/invites")
async def create_invite(body:InviteCreateIn,user:User=Depends(current_user),db:AsyncSession=Depends(get_db)):
    if not user.is_admin:raise HTTPException(403,"Admin required")
    raw=new_token();inv=Invite(token_hash=token_digest(raw),email=str(body.email).lower() if body.email else None,created_by=user.id,expires_at=now()+timedelta(hours=body.expires_hours));db.add(inv);await db.commit();return {"token":raw,"expires_at":inv.expires_at}
@router.post("/invites/accept")
async def accept_invite(body:InviteAcceptIn,response:Response,db:AsyncSession=Depends(get_db)):
    inv=(await db.execute(select(Invite).where(Invite.token_hash==token_digest(body.token)).with_for_update())).scalar_one_or_none()
    email=str(body.email).lower()
    if not inv or inv.used_at is not None or inv.expires_at<=now() or (inv.email and inv.email!=email):raise HTTPException(400,"Invalid invite")
    if (await db.execute(select(User.id).where(User.email==email))).scalar_one_or_none():raise HTTPException(409,"Account exists")
    user=User(email=email,display_name=body.display_name.strip(),password_hash=hash_password(body.password));db.add(user);await db.flush();inv.used_at=now();await db.commit()
    raw=await issue_session(db,user,body.device_name);set_cookie(response,raw);return {"ok":True}
