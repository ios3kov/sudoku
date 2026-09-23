import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import UserContact
from .security import normalize_phone_e164


def normalize_contact_phones(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        try:
            phone = normalize_phone_e164(value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if phone not in seen:
            seen.add(phone)
            normalized.append(phone)
    return normalized


async def contact_user_ids(
    db: AsyncSession,
    owner_user_id: uuid.UUID,
) -> set[uuid.UUID]:
    return set(
        (
            await db.execute(
                select(UserContact.contact_user_id).where(
                    UserContact.owner_user_id == owner_user_id
                )
            )
        )
        .scalars()
        .all()
    )


async def require_contacts(
    db: AsyncSession,
    owner_user_id: uuid.UUID,
    target_user_ids: set[uuid.UUID],
) -> None:
    if not target_user_ids:
        return
    allowed = set(
        (
            await db.execute(
                select(UserContact.contact_user_id).where(
                    UserContact.owner_user_id == owner_user_id,
                    UserContact.contact_user_id.in_(target_user_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if allowed != target_user_ids:
        raise HTTPException(
            status_code=403,
            detail="New conversations are limited to synced phone contacts",
        )
