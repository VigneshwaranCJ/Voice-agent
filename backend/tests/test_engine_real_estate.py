from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.models import Appointment, Lead, ToolExecution
from tests.conftest import call, new_engine, say, tool_results


async def test_property_enquiry_uses_database(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("search_properties", city="Coimbatore", bhk=2, property_type="apartment"),
              lambda msgs: say(f"I found {tool_results(msgs)[0]['count']} options."))
    res = await engine.handle_turn(state, "I am looking for a 2BHK apartment in Coimbatore.", "en-IN")
    assert res.reply == "I found 2 options."
    assert res.tool_calls == [{"name": "search_properties", "ok": True}]
    found = tool_results(llm.calls[-1])[0]["properties"]
    assert {p["locality"] for p in found} == {"Saravanampatti", "Peelamedu"}
    # Prompt grounding: system prompt forbids invention and carries business context, not the whole DB.
    system = llm.calls[0][0]["content"]
    assert "never invent" in system.lower() and "Sunrise Realty" in system
    assert "Sunrise Bayview" not in system
    logged = (await db.execute(select(ToolExecution).where(ToolExecution.conversation_id == state.conversation_id))).scalars().all()
    assert [t.tool_name for t in logged] == ["search_properties"] and logged[0].status == "success"


async def test_budget_filter(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("search_properties", city="Coimbatore", max_budget_inr=6_000_000), say("ok"))
    await engine.handle_turn(state, "budget 60 lakh", "en-IN")
    props = tool_results(llm.calls[-1])[0]["properties"]
    assert props and all("Meadows 2BHK" in p["name"] or "Plots" in p["name"] for p in props)


async def test_site_visit_requires_confirmation_then_books(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("search_properties", locality="Saravanampatti", bhk=2), say("Sunrise Meadows has units."))
    await engine.handle_turn(state, "2BHK in Saravanampatti", "en-IN")
    pid = tool_results(llm.calls[-1])[0]["properties"][0]["property_id"]
    day = (datetime.now(ZoneInfo("Asia/Kolkata")) + timedelta(days=2)).strftime("%Y-%m-%d")
    args = dict(property_id=pid, date=day, time="11:00", name="Ravi", phone="+91 98765 43210")

    llm.queue(call("schedule_site_visit", **args), say("Shall I confirm?"))
    await engine.handle_turn(state, "Book a visit day after tomorrow 11 am, Ravi, 9876543210", "en-IN")
    assert tool_results(llm.calls[-1])[0]["needs_confirmation"] is True
    assert not (await db.execute(select(Appointment))).scalars().all()

    llm.queue(call("schedule_site_visit", **args, confirmed=True), say("Booked."))
    await engine.handle_turn(state, "Yes, confirm", "en-IN")
    out = tool_results(llm.calls[-1])[-1]
    assert out["ok"] and out["sales_executive"] == "Arun"
    appt = (await db.execute(select(Appointment))).scalar_one()
    assert appt.kind == "site_visit" and appt.contact_phone == "9876543210"
    lead = (await db.execute(select(Lead))).scalar_one()
    assert lead.assigned_to == "Arun" and lead.details["appointment_id"] == appt.id
    assert state.customer_id is not None


async def test_site_visit_rejects_past_and_offhours(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("search_properties", city="Chennai"), say("ok"))
    await engine.handle_turn(state, "Chennai", "en-IN")
    pid = tool_results(llm.calls[-1])[0]["properties"][0]["property_id"]
    day = (datetime.now(ZoneInfo("Asia/Kolkata")) + timedelta(days=1)).strftime("%Y-%m-%d")
    args = dict(property_id=pid, date=day, time="21:00", name="A", phone="9876543210")
    llm.queue(call("schedule_site_visit", **args), say("Confirm?"))
    await engine.handle_turn(state, "9 pm", "en-IN")
    llm.queue(call("schedule_site_visit", **args, confirmed=True), say("ok"))
    await engine.handle_turn(state, "yes", "en-IN")
    assert "9 AM" in tool_results(llm.calls[-1])[-1]["error"]
