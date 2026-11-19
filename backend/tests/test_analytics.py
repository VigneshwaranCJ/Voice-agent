"""Dashboard analytics: days and hours are counted in the business's timezone, and stay tenant-scoped."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import Conversation, EscalationRecord, Lead
from tests.conftest import login

ADMIN_PW = "ChangeMe-Admin-123"


async def test_overview_uses_business_timezone_and_counts_follow_ups(client, db):
    admin = login(client, "admin@platform.local", ADMIN_PW)
    t = client.post("/api/v1/tenants", headers=admin,
                    json={"name": "Night Owl Clinic", "slug": "night-owl-clinic", "industry": "custom"}).json()
    h = {**admin, "X-Tenant-ID": t["id"]}
    profile = client.get("/api/v1/business-profile", headers=h).json()
    client.put("/api/v1/business-profile", headers=h, json={**profile, "timezone": "Asia/Kolkata"})
    agent = client.post("/api/v1/agents", headers=h, json={"name": "Desk", "industry": "custom"}).json()

    # 00:45 IST today = 19:15 UTC yesterday: it must count as *today* at hour 0 in India.
    ist = ZoneInfo("Asia/Kolkata")
    local = datetime.now(ist).replace(hour=0, minute=45, second=0, microsecond=0)
    if local > datetime.now(ist):  # keep it in the past
        local -= timedelta(days=1)
    at_utc = local.astimezone(UTC)
    conv = Conversation(tenant_id=t["id"], agent_id=agent["id"], channel="web_text", status="escalated", created_at=at_utc)
    db.add(conv)
    await db.flush()
    db.add_all([
        Lead(tenant_id=t["id"], name="A", status="new"), Lead(tenant_id=t["id"], name="B", status="won"),
        EscalationRecord(tenant_id=t["id"], conversation_id=conv.id, reason="customer_request", status="open"),
    ])
    await db.commit()

    o = client.get("/api/v1/analytics/overview?days=30", headers=h).json()
    assert o["timezone"] == "Asia/Kolkata"
    assert o["daily"] == [{"date": local.date().isoformat(), "count": 1}]
    assert o["hours"][0] == 1 and sum(o["hours"]) == 1 and len(o["hours"]) == 24
    assert o["leads"] == {"total": 2, "by_status": {"new": 1, "won": 1}}
    assert o["escalations"] == {"total": 1, "by_status": {"open": 1}}

    # Another business sees none of it.
    empty = client.post("/api/v1/tenants", headers=admin,
                        json={"name": "Empty Shop", "slug": "empty-shop-analytics", "industry": "custom"}).json()
    other = client.get("/api/v1/analytics/overview?days=30", headers={**admin, "X-Tenant-ID": empty["id"]}).json()
    assert other["total_conversations"] == 0 and other["daily"] == [] and sum(other["hours"]) == 0
    assert other["leads"] == {"total": 0, "by_status": {}} and other["escalations"]["total"] == 0
