"""Changing your own password: needs the current password, only ever touches the signed-in user."""

import uuid

from sqlalchemy import select

from app.models import Tenant, User
from app.security.crypto import hash_password
from tests.conftest import TENANT_PW, login

OLD = "Old-Password-12345"
NEW = "New-Password-67890"


async def _user(db, slug: str = "sunrise-realty") -> str:
    """A throwaway tenant user, so seeded accounts used by other tests keep their passwords."""
    tenant = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one()
    email = f"pw-{uuid.uuid4().hex[:8]}@sunrise.local"
    db.add(User(tenant_id=tenant.id, email=email, full_name="PW Test", role="tenant_admin",
                password_hash=hash_password(OLD)))
    await db.commit()
    return email


def _change(client, headers, current, new):
    return client.post("/api/v1/auth/change-password", headers=headers,
                       json={"current_password": current, "new_password": new})


async def test_change_password_flow(client, db):
    email = await _user(db)
    h = login(client, email, OLD)
    assert _change(client, h, OLD, NEW).status_code == 204
    assert client.post("/api/v1/auth/login", json={"email": email, "password": OLD}).status_code == 401
    login(client, email, NEW)


async def test_wrong_current_password_is_400_not_401(client, db):
    email = await _user(db)
    h = login(client, email, OLD)
    r = _change(client, h, "not-the-password-000", NEW)
    assert r.status_code == 400  # a 401 would sign the dashboard out
    login(client, email, OLD)


async def test_new_password_rules(client, db):
    email = await _user(db)
    h = login(client, email, OLD)
    assert _change(client, h, OLD, "short").status_code == 422
    assert _change(client, h, OLD, OLD).status_code == 400
    login(client, email, OLD)


async def test_needs_a_session_and_only_changes_own_password(client, db):
    assert _change(client, {}, OLD, NEW).status_code == 401
    email = await _user(db)
    h = login(client, email, OLD)
    # Extra body fields can't redirect the change to another user.
    r = client.post("/api/v1/auth/change-password", headers=h,
                    json={"current_password": OLD, "new_password": NEW, "email": "admin@sunrise.local",
                          "user_id": "someone-else"})
    assert r.status_code == 204
    login(client, "admin@sunrise.local", TENANT_PW)  # untouched
    login(client, email, NEW)
