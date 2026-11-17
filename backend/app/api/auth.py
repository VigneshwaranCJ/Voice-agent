from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, Principal, audit, get_principal
from app.models import Tenant, User
from app.schemas.api import LoginIn, TokenOut
from app.security.crypto import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_dict(u: User, tenant: Tenant | None) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "tenant_id": u.tenant_id,
            "tenant_name": tenant.name if tenant else None}


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, db: AsyncSession = DB):
    u = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if not u or not u.is_active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Invalid email or password")
    tenant = await db.get(Tenant, u.tenant_id) if u.tenant_id else None
    if tenant and not tenant.is_active:
        raise HTTPException(403, "Tenant is disabled")
    u.last_login_at = datetime.now(UTC)
    p = Principal(u.id, u.role, u.tenant_id, u.tenant_id)
    await audit(db, request, p, "login", "user", u.id)
    await db.commit()
    return TokenOut(access_token=create_access_token(user_id=u.id, tenant_id=u.tenant_id, role=u.role),
                    user=_user_dict(u, tenant))


@router.get("/me")
async def me(p: Principal = Depends(get_principal), db: AsyncSession = DB):
    u = await db.get(User, p.user_id)
    if not u:
        raise HTTPException(404, "User not found")
    tenant = await db.get(Tenant, u.tenant_id) if u.tenant_id else None
    return _user_dict(u, tenant)
