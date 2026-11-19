"""Team management and lead/escalation follow-up: permissions, tenant isolation, lock-out on deactivation."""

import uuid

from sqlalchemy import select

from app.models import Conversation, EscalationRecord, Lead, Tenant
from tests.conftest import TENANT_PW, agent_for, login

ADMIN_PW = "ChangeMe-Admin-123"
NEW_PW = "Brand-New-Pass-123"


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


def _add_user(client, headers, role="tenant_agent", password=NEW_PW, **extra):
    return client.post("/api/v1/users", headers=headers,
                       json={"email": _email(role), "full_name": "Test User", "role": role, "password": password, **extra})


async def _tenant_id(db, slug: str) -> str:
    return (await db.execute(select(Tenant.id).where(Tenant.slug == slug))).scalar_one()


# ---------- team ----------

async def test_team_is_scoped_to_the_callers_business(client, db):
    h = login(client, "admin@sunrise.local")
    sunrise = await _tenant_id(db, "sunrise-realty")
    users = client.get("/api/v1/users", headers=h).json()
    assert users and all("@sunrise.local" in u["email"] or u["email"].endswith("@example.com") for u in users)
    assert all(u.get("role") in ("tenant_admin", "tenant_agent") for u in users)
    # Spoofing another business is refused, and the new user lands in the caller's own business.
    carewell = await _tenant_id(db, "carewell-hospital")
    assert client.get("/api/v1/users", headers={**h, "X-Tenant-ID": carewell}).status_code == 403
    r = _add_user(client, h, tenant_id=carewell)  # extra body field must be ignored
    assert r.status_code == 201
    carewell_admin = login(client, "admin@carewell.local")
    assert r.json()["id"] not in [u["id"] for u in client.get("/api/v1/users", headers=carewell_admin).json()]
    assert r.json()["id"] in [u["id"] for u in client.get("/api/v1/users", headers=h).json()]
    assert sunrise  # sanity: seeded


async def test_tenant_admin_cannot_create_platform_admins_or_duplicates(client):
    h = login(client, "admin@sunrise.local")
    assert _add_user(client, h, role="platform_admin").status_code == 422
    assert _add_user(client, h, password="short").status_code == 422
    email = _email("dup")
    first = client.post("/api/v1/users", headers=h, json={"email": email, "role": "tenant_agent", "password": NEW_PW})
    assert first.status_code == 201
    carewell = login(client, "admin@carewell.local")  # emails are unique across businesses too
    dup = client.post("/api/v1/users", headers=carewell, json={"email": email.upper(), "role": "tenant_agent",
                                                               "password": NEW_PW})
    assert dup.status_code == 409


async def test_agents_can_list_but_not_manage(client):
    admin = login(client, "admin@sunrise.local")
    created = _add_user(client, admin).json()
    agent = login(client, created["email"], NEW_PW)
    assert client.get("/api/v1/users", headers=agent).status_code == 200  # to pick an assignee
    assert _add_user(client, agent).status_code == 403
    assert client.patch(f"/api/v1/users/{created['id']}", headers=agent, json={"full_name": "x"}).status_code == 403


async def test_deactivation_locks_the_user_out_immediately(client):
    admin = login(client, "admin@sunrise.local")
    created = _add_user(client, admin).json()
    their = login(client, created["email"], NEW_PW)
    assert client.get("/api/v1/auth/me", headers=their).status_code == 200
    assert client.patch(f"/api/v1/users/{created['id']}", headers=admin, json={"is_active": False}).status_code == 200
    assert client.get("/api/v1/auth/me", headers=their).status_code == 401  # existing token stops working
    assert client.post("/api/v1/auth/login", json={"email": created["email"], "password": NEW_PW}).status_code == 401
    client.patch(f"/api/v1/users/{created['id']}", headers=admin, json={"is_active": True})
    login(client, created["email"], NEW_PW)


async def test_role_change_takes_effect_without_new_login(client):
    admin = login(client, "admin@sunrise.local")
    created = _add_user(client, admin, role="tenant_admin").json()
    their = login(client, created["email"], NEW_PW)
    assert _add_user(client, their).status_code == 201
    client.patch(f"/api/v1/users/{created['id']}", headers=admin, json={"role": "tenant_agent"})
    assert _add_user(client, their).status_code == 403  # the token's old role is not trusted


async def test_admins_cannot_lock_themselves_out(client):
    admin = login(client, "admin@sunrise.local")
    me = client.get("/api/v1/auth/me", headers=admin).json()
    assert client.patch(f"/api/v1/users/{me['id']}", headers=admin, json={"is_active": False}).status_code == 400
    assert client.patch(f"/api/v1/users/{me['id']}", headers=admin, json={"role": "tenant_agent"}).status_code == 400
    assert client.post(f"/api/v1/users/{me['id']}/reset-password", headers=admin,
                       json={"new_password": NEW_PW}).status_code == 400


async def test_password_reset_is_scoped(client):
    sunrise = login(client, "admin@sunrise.local")
    created = _add_user(client, sunrise).json()
    carewell = login(client, "admin@carewell.local")
    assert client.post(f"/api/v1/users/{created['id']}/reset-password", headers=carewell,
                       json={"new_password": "Other-Tenant-Pass-1"}).status_code == 404
    assert client.patch(f"/api/v1/users/{created['id']}", headers=carewell, json={"is_active": False}).status_code == 404
    assert client.post(f"/api/v1/users/{created['id']}/reset-password", headers=sunrise,
                       json={"new_password": "Reset-By-Admin-123"}).status_code == 204
    login(client, created["email"], "Reset-By-Admin-123")


async def test_platform_scope_manages_platform_admins_only(client, db):
    h = login(client, "admin@platform.local", ADMIN_PW)
    users = client.get("/api/v1/users", headers=h).json()
    assert users and all(u["role"] == "platform_admin" for u in users)
    assert _add_user(client, h, role="tenant_admin").status_code == 422  # no business selected
    sunrise = await _tenant_id(db, "sunrise-realty")
    in_business = _add_user(client, {**h, "X-Tenant-ID": sunrise}, role="tenant_admin")
    assert in_business.status_code == 201
    sunrise_admin = login(client, "admin@sunrise.local")
    assert in_business.json()["id"] in [u["id"] for u in client.get("/api/v1/users", headers=sunrise_admin).json()]


# ---------- leads & escalations ----------

async def _lead(db, slug: str) -> str:
    lead = Lead(tenant_id=await _tenant_id(db, slug), name="Asha", phone="+919000000001", interest="2BHK")
    db.add(lead)
    await db.commit()
    return lead.id


async def _escalation(db, slug: str) -> str:
    agent = await agent_for(db, slug)
    conv = Conversation(tenant_id=agent.tenant_id, agent_id=agent.id, channel="web_text", status="escalated")
    db.add(conv)
    await db.flush()
    esc = EscalationRecord(tenant_id=agent.tenant_id, conversation_id=conv.id, reason="customer_request",
                           summary="Wants a person", context={"turns": 3})
    db.add(esc)
    await db.commit()
    return esc.id


async def test_lead_workflow_and_isolation(client, db):
    lead_id = await _lead(db, "sunrise-realty")
    h = login(client, "admin@sunrise.local")
    r = client.patch(f"/api/v1/leads/{lead_id}", headers=h,
                     json={"status": "contacted", "assigned_to": "Ravi", "notes": "Called, visiting Saturday"})
    assert r.status_code == 200 and r.json()["status"] == "contacted" and r.json()["notes"] == "Called, visiting Saturday"
    row = next(x for x in client.get("/api/v1/leads", headers=h).json() if x["id"] == lead_id)
    assert row["assigned_to"] == "Ravi" and row["notes"] == "Called, visiting Saturday"
    # Clearing the assignee with null; leaving notes untouched when not sent.
    r = client.patch(f"/api/v1/leads/{lead_id}", headers=h, json={"assigned_to": None})
    assert r.json()["assigned_to"] is None and r.json()["notes"] == "Called, visiting Saturday"
    assert client.patch(f"/api/v1/leads/{lead_id}", headers=h, json={"status": "bogus"}).status_code == 422
    other = login(client, "admin@carewell.local")
    assert client.patch(f"/api/v1/leads/{lead_id}", headers=other, json={"status": "lost"}).status_code == 404
    assert lead_id not in [x["id"] for x in client.get("/api/v1/leads", headers=other).json()]


async def test_escalation_workflow_and_isolation(client, db):
    esc_id = await _escalation(db, "carewell-hospital")
    h = login(client, "admin@carewell.local")
    r = client.patch(f"/api/v1/escalations/{esc_id}", headers=h, json={"assigned_to": "Dr. Meena"})
    assert r.json()["status"] == "assigned"  # assigning takes it out of the open queue
    r = client.patch(f"/api/v1/escalations/{esc_id}", headers=h, json={"status": "resolved", "notes": "Called back"})
    body = r.json()
    assert body["status"] == "resolved" and body["notes"] == "Called back" and body["context"]["turns"] == 3
    assert esc_id in [e["id"] for e in client.get("/api/v1/escalations?status=resolved", headers=h).json()]
    other = login(client, "admin@sunrise.local", TENANT_PW)
    assert client.patch(f"/api/v1/escalations/{esc_id}", headers=other, json={"status": "open"}).status_code == 404
