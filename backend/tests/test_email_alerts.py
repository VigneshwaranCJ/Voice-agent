"""Email alerts: off without SMTP (no fake success), and only the lead's own business admins are emailed."""

import time

import pytest
from sqlalchemy import select

import app.notifications.email as email_mod
from app.core.config import get_settings
from app.models import User
from tests.conftest import agent_for, call, login, say


@pytest.fixture
def outbox(monkeypatch):
    """Turn SMTP 'on' and capture messages instead of sending them."""
    sent: list[dict] = []
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(s, "smtp_from", "alerts@example.test")
    monkeypatch.setattr(email_mod, "_send_sync", lambda to, subject, body: sent.append({"to": to, "subject": subject, "body": body}))
    return sent


def _wait_for(outbox, n=1, timeout=3.0):
    end = time.time() + timeout
    while len(outbox) < n and time.time() < end:
        time.sleep(0.05)
    return outbox


async def test_not_configured_means_no_email_and_a_clear_error(client):
    h = login(client, "admin@sunrise.local")
    assert client.get("/api/v1/notifications/email", headers=h).json()["configured"] is False
    r = client.post("/api/v1/notifications/email/test", headers=h)
    assert r.status_code == 503 and "not configured" in r.json()["detail"]


async def test_new_lead_emails_only_this_business_admins(client, db, llm, outbox):
    realty = await agent_for(db, "sunrise-realty")
    # A second, deactivated admin must not be emailed.
    db.add(User(tenant_id=realty.tenant_id, email="former-admin@example.com", role="tenant_admin",
                password_hash="x", is_active=False))
    await db.commit()
    h = login(client, "admin@sunrise.local")
    llm.queue(call("create_customer_lead", name="Asha", phone="9876543210", interest="2BHK in Coimbatore", budget="60L"),
              say("Saved, our team will call you."))
    r = client.post(f"/api/v1/agents/{realty.id}/chat", headers=h, json={"text": "Please call me back"})
    assert r.status_code == 200
    msgs = _wait_for(outbox)
    assert len(msgs) == 1
    assert msgs[0]["to"] == ["admin@sunrise.local"]  # active admins of this business only
    assert "Asha" in msgs[0]["subject"] and "9876543210" in msgs[0]["body"] and "60L" in msgs[0]["body"]


async def test_escalation_email_is_marked_urgent_for_distress(client, db, llm, outbox):
    hospital = await agent_for(db, "carewell-hospital")
    h = login(client, "admin@carewell.local")
    llm.queue(call("transfer_to_human", reason="distress", summary="Caller is very upset about a bill"), say("Connecting you."))
    client.post(f"/api/v1/agents/{hospital.id}/chat", headers=h, json={"text": "I want a person now"})
    msgs = _wait_for(outbox)
    assert msgs and msgs[0]["subject"].startswith("URGENT") and msgs[0]["to"] == ["admin@carewell.local"]


async def test_mail_server_failure_never_breaks_the_call(client, db, llm, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(s, "smtp_from", "alerts@example.test")

    def boom(*_):
        raise OSError("connection refused")

    monkeypatch.setattr(email_mod, "_send_sync", boom)
    realty = await agent_for(db, "sunrise-realty")
    llm.queue(call("create_customer_lead", name="Ravi", phone="9876500000", interest="Villa"), say("Done."))
    r = client.post(f"/api/v1/agents/{realty.id}/chat", headers=login(client, "admin@sunrise.local"), json={"text": "hi"})
    assert r.status_code == 200 and r.json()["reply"] == "Done."
    h = login(client, "admin@sunrise.local")
    assert client.post("/api/v1/notifications/email/test", headers=h).status_code == 502  # test button reports it


async def test_staff_cannot_use_notification_settings(client, db):
    admin = login(client, "admin@sunrise.local")
    client.post("/api/v1/users", headers=admin, json={"email": "staff-n@example.com", "role": "tenant_agent",
                                                      "password": "Staff-Pass-12345"})
    staff = login(client, "staff-n@example.com", "Staff-Pass-12345")
    assert client.get("/api/v1/notifications/email", headers=staff).status_code == 403
    assert (await db.execute(select(User).where(User.email == "staff-n@example.com"))).scalar_one().role == "tenant_agent"
