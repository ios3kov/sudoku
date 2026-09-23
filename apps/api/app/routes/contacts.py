import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..contacts import normalize_contact_phones
from ..db import get_db
from ..deps import AuthContext, get_auth_context
from ..models import AuditEvent, User, UserContact
from ..rate_limit import enforce_ip_rate_limit, enforce_user_rate_limit
from ..schemas import ContactDirectoryItem, ContactSyncRequest

router = APIRouter(prefix="/v1", tags=["contacts"])


async def _directory(
    db: AsyncSession,
    owner_user_id: uuid.UUID,
    term: str = "",
) -> list[ContactDirectoryItem]:
    query = (
        select(User)
        .join(UserContact, UserContact.contact_user_id == User.id)
        .where(
            UserContact.owner_user_id == owner_user_id,
            User.status == "active",
            User.phone_e164.is_not(None),
            User.phone_verified_at.is_not(None),
        )
    )
    normalized_term = term.strip().casefold()
    if normalized_term:
        escaped = normalized_term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(
            or_(
                func.lower(User.display_name).like(f"%{escaped}%", escape="\\"),
                User.phone_e164.like(f"%{escaped}%", escape="\\"),
            )
        )
    users = (await db.execute(query.order_by(User.display_name).limit(100))).scalars().all()
    return [
        ContactDirectoryItem(
            id=user.id,
            display_name=user.display_name,
            phone_e164=user.phone_e164,
        )
        for user in users
        if user.phone_e164 is not None
    ]


@router.get("/contacts", response_model=list[ContactDirectoryItem])
async def list_contacts(
    q: str = Query(default="", max_length=120),
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "contact-list", 120, 60)
    return await _directory(db, auth.user.id, q)


@router.post("/contacts/sync", response_model=list[ContactDirectoryItem])
async def sync_contacts(
    payload: ContactSyncRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "contact-sync", 12, 3600)
    client_ip = request.client.host if request.client else "unknown"
    await enforce_ip_rate_limit(client_ip, "contact-sync", 60, 3600)

    phones = normalize_contact_phones(payload.phones)
    matched = (
        await db.execute(
            select(User).where(
                User.phone_e164.in_(phones),
                User.phone_verified_at.is_not(None),
                User.status == "active",
                User.id != auth.user.id,
            )
        )
    ).scalars().all()
    matched_ids = {user.id for user in matched}

    if payload.replace:
        await db.execute(
            delete(UserContact).where(UserContact.owner_user_id == auth.user.id)
        )
        existing_ids: set[uuid.UUID] = set()
    else:
        existing_ids = set(
            (
                await db.execute(
                    select(UserContact.contact_user_id).where(
                        UserContact.owner_user_id == auth.user.id,
                        UserContact.contact_user_id.in_(matched_ids),
                    )
                )
            )
            .scalars()
            .all()
        )

    for user_id in matched_ids - existing_ids:
        db.add(UserContact(owner_user_id=auth.user.id, contact_user_id=user_id))

    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="contacts.synced",
            target_type="user",
            target_id=auth.user.id,
        )
    )
    await db.commit()
    return await _directory(db, auth.user.id)


@router.delete("/contacts/{user_id}", status_code=204)
async def remove_contact(
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth_context),
    db: AsyncSession = Depends(get_db),
):
    await enforce_user_rate_limit(auth.user.id, "contact-remove", 60, 60)
    result = await db.execute(
        delete(UserContact).where(
            UserContact.owner_user_id == auth.user.id,
            UserContact.contact_user_id == user_id,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    db.add(
        AuditEvent(
            actor_user_id=auth.user.id,
            event_type="contacts.removed",
            target_type="user",
            target_id=user_id,
        )
    )
    await db.commit()
