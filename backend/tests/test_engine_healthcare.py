from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.industries.healthcare.models import DoctorSlot
from app.models import Appointment, EscalationRecord
from tests.conftest import call, new_engine, say, tool_results


def _next_weekday() -> str:
    d = datetime.now(ZoneInfo("Asia/Kolkata")) + timedelta(days=1)
    while d.weekday() == 6:
        d += timedelta(days=1)
    return d.strftime("%Y-%m-%d")


async def test_doctor_availability(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    day = _next_weekday()
    llm.queue(call("search_doctors", specialization="cardiologist"),
              call("check_appointment_availability", specialization="cardiologist", date=day), say("Slots available."))
    res = await engine.handle_turn(state, "I want to book an appointment with a cardiologist tomorrow", "en-IN")
    docs, avail = tool_results(llm.calls[-1])
    assert {d["name"] for d in docs["doctors"]} == {"Dr. Ramesh Kumar", "Dr. Lakshmi Narayanan"}
    assert len(avail["free_slots"]) > 0
    assert [t["name"] for t in res.tool_calls] == ["search_doctors", "check_appointment_availability"]


async def test_book_and_double_booking_and_cancel(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    llm.queue(call("check_appointment_availability", specialization="paediatric", date=_next_weekday()), say("ok"))
    await engine.handle_turn(state, "child doctor", "en-IN")
    slot_id = tool_results(llm.calls[-1])[0]["free_slots"][0]["slot_id"]
    book = dict(slot_id=slot_id, patient_name="Asha", phone="9876500000")

    llm.queue(call("book_appointment", **book), say("Please confirm"))
    await engine.handle_turn(state, "book it", "en-IN")
    assert tool_results(llm.calls[-1])[0]["needs_confirmation"]

    llm.queue(call("book_appointment", **book, confirmed=True), say("Booked"))
    await engine.handle_turn(state, "yes", "en-IN")
    assert tool_results(llm.calls[-1])[-1]["ok"]
    slot = (await db.execute(select(DoctorSlot).where(DoctorSlot.id == slot_id))).scalar_one()
    assert slot.is_booked

    other = {**book, "patient_name": "Other"}
    llm.queue(call("book_appointment", **other), say("Confirm?"))
    await engine.handle_turn(state, "book same slot", "en-IN")
    llm.queue(call("book_appointment", **other, confirmed=True), say("Taken"))
    await engine.handle_turn(state, "yes", "en-IN")
    assert "no longer available" in tool_results(llm.calls[-1])[-1]["error"]

    # cancellation requires the booking phone number (and confirmation)
    for phone, ok in (("9000011111", False), ("9876500000", True)):
        llm.queue(call("cancel_appointment", phone=phone), say("Confirm cancel?"))
        await engine.handle_turn(state, f"cancel, my number is {phone}", "en-IN")
        llm.queue(call("cancel_appointment", phone=phone, confirmed=True), say("done"))
        await engine.handle_turn(state, "yes", "en-IN")
        assert tool_results(llm.calls[-1])[-1]["ok"] is ok
    await db.refresh(slot)
    assert not slot.is_booked
    assert (await db.execute(select(Appointment))).scalar_one().status == "cancelled"


async def test_emergency_escalates_without_llm(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    res = await engine.handle_turn(state, "My father has severe chest pain and is sweating", "en-IN")
    assert "108" in res.reply
    assert llm.calls == []  # deterministic guard, no LLM round-trip
    assert res.escalated and res.events[0]["type"] == "handoff" and res.events[0]["priority"] == "critical"
    rec = (await db.execute(select(EscalationRecord))).scalar_one()
    assert rec.reason == "emergency" and rec.priority == "critical"


async def test_tamil_emergency(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    res = await engine.handle_turn(state, "அம்மாவுக்கு நெஞ்சு வலி அதிகமா இருக்கு", "ta-IN")
    assert res.language == "ta-IN" and "108" in res.reply and "அவசர" in res.reply


async def test_emergency_guard_only_for_healthcare(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(say("ok"))
    res = await engine.handle_turn(state, "Is there an accident-free parking design?", "en-IN")
    assert not res.escalated and len(llm.calls) == 1


async def test_llm_cannot_self_confirm_booking(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    llm.queue(call("check_appointment_availability", specialization="cardio", date=_next_weekday()), say("ok"))
    await engine.handle_turn(state, "cardiologist", "en-IN")
    slot_id = tool_results(llm.calls[-1])[0]["free_slots"][0]["slot_id"]
    args = dict(slot_id=slot_id, patient_name="Lakshmi", phone="9876500011")
    # Same turn: read-back request followed by an immediate confirmed=true → still not booked.
    llm.queue(call("book_appointment", **args), call("book_appointment", **args, confirmed=True), say("Shall I book?"))
    await engine.handle_turn(state, "Dr Ramesh is fine", "en-IN")
    assert all(r.get("needs_confirmation") for r in tool_results(llm.calls[-1]))
    assert not (await db.execute(select(Appointment))).scalars().all()
    # Caller didn't say yes ("hmm, what time again?") → still blocked even with confirmed=true.
    llm.queue(call("book_appointment", **args, confirmed=True), say("It is at 10 AM. Shall I book it?"))
    await engine.handle_turn(state, "hmm what time again", "en-IN")
    assert tool_results(llm.calls[-1])[-1]["needs_confirmation"]
    assert not (await db.execute(select(Appointment))).scalars().all()
    # Caller says yes to the agent's question → booked.
    llm.queue(call("book_appointment", **args, confirmed=True), say("Booked"))
    await engine.handle_turn(state, "yes please", "en-IN")
    assert tool_results(llm.calls[-1])[-1]["ok"]
