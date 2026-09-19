from datetime import datetime,timedelta,timezone
from fastapi import APIRouter,Cookie,Depends,HTTPException,Request,Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .config import settings
from .db import get_db
from .models import Invite,Session,User
from .rate_limit import limit
from .schemas import InviteAcceptIn,InviteCreateIn,LoginIn,UserOut
from .security import hash_password,new_token,token_digest,verify_password
router=APIRouter(prefix="/v1")
def now():return datetime.now(timezone.utc)
async def current_session(session_token:str|None=Cookie(default=None,alias=settings.session_cookie),db:AsyncSession=Depends(get_db)):
    if not session_token:raise HTTPException(401,"Authentication required")
    row=await db.execute(select(Session,User).join(User,Session.user_id==User.id).where(Session.token_hash==token_digest(session_token),Session.revoked_at.is_(None),Session.expires_at>now(),User.active.is_(True)))
    value=row.first()
    if not value:raise HTTPException(401,"Authentication required")
    return value
async def current_user(value=Depends(current_session)):return value[1]
async def issue_session(db,user,device):
    raw=new_token();db.add(Session(user_id=user.id,token_hash=token_digest(raw),device_name=device,expires_at=now()+timedelta(days=settings.session_days)));await db.commit();return raw
def set_cookie(response,raw):response.set_cookie(settings.session_cookie,raw,httponly=True,secure=settings.secure_cookies,samesite="lax",max_age=settings.session_days*86400,path="/")
@router.get("/me",response_model=UserOut)
async def me(user:User=Depends(current_user)):return UserOut(id=str(user.id),email=user.email,display_name=user.display_name,is_admin=user.is_admin)
@router.get("/sessions")
async def sessions(value=Depends(current_session),db:AsyncSession=Depends(get_db)):
    session,user=value;rows=(await db.execute(select(Session).where(Session.user_id==user.id,Session.revoked_at.is_(None),Session.expires_at>now()).order_by(Session.created_at.desc()))).scalars().all()
    return [{"id":str(x.id),"device_name":x.device_name,"created_at":x.created_at,"expires_at":x.expires_at,"current":x.id==session.id} for x in rows]
@router.delete("/sessions/{session_id}")
async def revoke(session_id:str,response:Response,value=Depends(current_session),db:AsyncSession=Depends(get_db)):
    session,user=value;target=(await db.execute(select(Session).where(Session.id==session_id,Session.user_id==user.id,Session.revoked_at.is_(None)))).scalar_one_or_none()
    if not target:raise HTTPException(404,"Session not found")
    target.revoked_at=now();await db.commit()
    if target.id==session.id:response.delete_cookie(settings.session_cookie,path="/")
    return {"ok":True}
@router.post("/auth/login")
async def login(body:LoginIn,request:Request,response:Response,db:AsyncSession=Depends(get_db)):
    email=str(body.email).lower();ip=request.client.host if request.client else "unknown"
    await limit("login-ip",ip,20,300);await limit("login-email",email,8,300)
    user=(await db.execute(select(User).where(User.email==email,User.active.is_(True)))).scalar_one_or_none()
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
    await limit("invite-create",str(user.id),20,3600)
    if not user.is_admin:raise HTTPException(403,"Admin required")
    raw=new_token();inv=Invite(token_hash=token_digest(raw),email=str(body.email).lower() if body.email else None,created_by=user.id,expires_at=now()+timedelta(hours=body.expires_hours));db.add(inv);await db.commit();return {"token":raw,"expires_at":inv.expires_at}
@router.post("/invites/accept")
async def accept_invite(body:InviteAcceptIn,request:Request,response:Response,db:AsyncSession=Depends(get_db)):
    ip=request.client.host if request.client else "unknown";await limit("invite-accept",ip,10,3600)
    inv=(await db.execute(select(Invite).where(Invite.token_hash==token_digest(body.token)).with_for_update())).scalar_one_or_none();email=str(body.email).lower()
    if not inv or inv.used_at is not None or inv.expires_at<=now() or (inv.email and inv.email!=email):raise HTTPException(400,"Invalid invite")
    if (await db.execute(select(User.id).where(User.email==email))).scalar_one_or_none():raise HTTPException(409,"Account exists")
    user=User(email=email,display_name=body.display_name.strip(),password_hash=hash_password(body.password));db.add(user);await db.flush();inv.used_at=now();await db.commit()
    raw=await issue_session(db,user,body.device_name);set_cookie(response,raw);return {"ok":True}
