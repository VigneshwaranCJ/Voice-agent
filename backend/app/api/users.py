"""Team management: the people who can sign in to a business's dashboard (or, for platform admins, the platform).

Scope always comes from the principal, never the request body:
- with a business selected (tenant users, or a platform admin sending X-Tenant-ID): that business's users;
- with no business selected (platform admins only): the platform admins.
Anyone in the scope may list it (to pick an assignee); only admins may change it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, ROLE_RANK, Principal, audit, get_principal
from app.models import User
from app.schemas.api import PasswordResetIn, UserCreateIn, UserUpdateIn
from app.security.crypto import hash_password

router = APIRouter(prefix="/users", tags=["users"])

TENANT_ROLES = {"tenant_admin", "tenant_agent"}


def _scope(p: Principal) -> str | None:
    """The tenant whose team this request works on; None means the platform admins."""
    if p.tenant_id is None and not p.is_platform_admin:
        raise HTTPException(400, "Select a business first")
    return p.tenant_id


def _require_admin(p: Principal) -> None:
    if ROLE_RANK.get(p.role, 0) < ROLE_RANK["tenant_admin"]:
        raise HTTPException(403, "Only admins can manage the team")


def _check_role(role: str, tenant_id: str | None) -> None:
    if tenant_id is None and role != "platform_admin":
        raise HTTPException(422, "Platform-level users must be platform admins; select a business to add its staff")
    if tenant_id is not None and role not in TENANT_ROLES:
        raise HTTPException(422, "Business users must be tenant_admin or tenant_agent")


def _out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "is_active": u.is_active,
            "last_login_at": u.last_login_at, "created_at": u.created_at}


async def _get_in_scope(db: AsyncSession, p: Principal, user_id: str) -> User:
    tenant_id = _scope(p)
    cond = User.tenant_id.is_(None) if tenant_id is None else User.tenant_id == tenant_id
    u = (await db.execute(select(User).where(User.id == user_id, cond))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    return u


@router.get("")
async def list_users(p: Principal = Depends(get_principal), db: AsyncSession = DB):
    tenant_id = _scope(p)
    cond = User.tenant_id.is_(None) if tenant_id is None else User.tenant_id == tenant_id
    rows = (await db.execute(select(User).where(cond).order_by(User.created_at))).scalars().all()
    return [_out(u) for u in rows]


@router.post("", status_code=201)
async def create_user(body: UserCreateIn, request: Request, p: Principal = Depends(get_principal),
                      db: AsyncSession = DB):
    _require_admin(p)
    tenant_id = _scope(p)
    _check_role(body.role, tenant_id)
    email = body.email.strip().lower()
    if (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")
    u = User(tenant_id=tenant_id, email=email, full_name=body.full_name.strip(), role=body.role,
             password_hash=hash_password(body.password))
    db.add(u)
    await db.flush()
    await audit(db, request, p, "create", "user", u.id, role=body.role)
    await db.commit()
    return _out(u)


@router.patch("/{user_id}")
async def update_user(user_id: str, body: UserUpdateIn, request: Request, p: Principal = Depends(get_principal),
                      db: AsyncSession = DB):
    _require_admin(p)
    u = await _get_in_scope(db, p, user_id)
    if u.id == p.user_id and (body.is_active is False or (body.role and body.role != u.role)):
        raise HTTPException(400, "You can't deactivate yourself or change your own role")
    changes = {}
    if body.full_name is not None:
        u.full_name = changes["full_name"] = body.full_name.strip()
    if body.role is not None:
        _check_role(body.role, u.tenant_id)
        u.role = changes["role"] = body.role
    if body.is_active is not None:
        u.is_active = changes["is_active"] = body.is_active
    await audit(db, request, p, "update", "user", u.id, **changes)
    await db.commit()
    return _out(u)


@router.post("/{user_id}/reset-password", status_code=204)
async def reset_password(user_id: str, body: PasswordResetIn, request: Request,
                         p: Principal = Depends(get_principal), db: AsyncSession = DB):
    """An admin sets a new password for a team member (e.g. a forgotten one). Use change-password for yourself."""
    _require_admin(p)
    u = await _get_in_scope(db, p, user_id)
    if u.id == p.user_id:
        raise HTTPException(400, "Use Change password for your own account")
    u.password_hash = hash_password(body.new_password)
    await audit(db, request, p, "reset_password", "user", u.id)
    await db.commit()
