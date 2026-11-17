from sqlalchemy import select

from app.models import ConversationMessage, EscalationRecord, ToolExecution
from app.orchestration.engine import greeting_for
from app.tools.registry import ToolSpec, _REGISTRY
from tests.conftest import call, new_engine, say, tool_results


async def test_human_handoff_request(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    res = await engine.handle_turn(state, "Can I talk to a real person please?", "en-IN")
    assert res.escalated and res.events[0]["reason"] == "customer_request"
    rec = (await db.execute(select(EscalationRecord))).scalar_one()
    assert rec.context["language"] == "en-IN"


async def test_tanglish_handoff(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    res = await engine.handle_turn(state, "executive kitta pesanum", "ta-IN")
    assert res.escalated and res.language == "ta-IN"


async def test_language_switch_and_prompt(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(say("வணக்கம்"), say("Sure"))
    await engine.handle_turn(state, "எனக்கு கோயம்புத்தூரில் வீடு வேணும்", "ta-IN")
    assert state.language == "ta-IN"
    assert "Reply in Tamil" in llm.calls[-1][0]["content"]
    await engine.handle_turn(state, "Actually let's continue in English", "en-IN")
    assert state.language == "en-IN" and state.languages_used == ["en-IN", "ta-IN"]
    assert "ONLY in simple Indian English" in llm.calls[-1][0]["content"]


async def test_unsupported_language_keeps_current(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(say("ok"))
    await engine.handle_turn(state, "hello", "bn-IN")  # agent configured for en/ta only
    assert state.language == "en-IN"


async def test_greetings(db, llm):
    engine, _ = await new_engine(db, "carewell-hospital", llm)
    assert "CareWell" in greeting_for(engine.bundle, "en-IN") and "Meera" in greeting_for(engine.bundle, "en-IN")
    assert "வணக்கம்" in greeting_for(engine.bundle, "ta-IN")


async def test_customer_context_across_calls(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("create_customer_lead", name="Priya", phone="9123456780", interest="3BHK villa", budget="1.2 crore"),
              say("Saved"))
    await engine.handle_turn(state, "I'm Priya, 9123456780, want a 3BHK villa around 1.2 crore", "en-IN")
    assert tool_results(llm.calls[-1])[0]["status"] == "qualified"

    engine2, state2 = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("identify_customer", phone="91234 56780"), say("Thanks"))
    await engine2.handle_turn(state2, "My number is 9123456780", "en-IN")
    out = tool_results(llm.calls[-1])[0]
    # Linked to the same customer record, but a phone number alone is not verification: no stored PII leaks.
    assert out["is_new_customer"] is False and out["verified"] is False and out["previous_enquiry_count"] == 1
    assert "Priya" not in str(out) and "villa" not in str(out)
    assert state2.customer_id == state.customer_id
    llm.queue(say("ok"))
    await engine2.handle_turn(state2, "anything new?", "en-IN")
    prompt = llm.calls[-1][0]["content"]
    assert "NOT verified" in prompt and "Priya" not in prompt


async def test_business_db_failure_is_handled(db, llm):
    spec = _REGISTRY["search_properties"]

    async def broken(ctx, args):
        raise ConnectionError("db down")

    _REGISTRY["search_properties"] = ToolSpec(spec.name, spec.description, spec.params, broken, spec.industry)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        llm.queue(call("search_properties", city="Coimbatore"), say("Sorry, our system is down right now."))
        res = await engine.handle_turn(state, "2BHK in Coimbatore", "en-IN")
        out = tool_results(llm.calls[-1])[0]
        assert out["ok"] is False and out["retryable"] and "db down" not in out["error"]
        assert res.reply.startswith("Sorry")
        ex = (await db.execute(select(ToolExecution))).scalar_one()
        assert ex.status == "error"
        # The call keeps working after the rollback that followed the failure.
        llm.queue(say("Anything else?"))
        res2 = await engine.handle_turn(state, "okay thanks", "en-IN")
        assert res2.reply == "Anything else?" and "Sunrise Realty" in llm.calls[-1][0]["content"]
    finally:
        _REGISTRY["search_properties"] = spec


async def test_disabled_and_foreign_tools_denied(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("book_appointment", slot_id="x", patient_name="a", phone="9876543210", confirmed=True), say("no"))
    await engine.handle_turn(state, "book doctor", "en-IN")
    assert "not available" in tool_results(llm.calls[-1])[0]["error"]


async def test_invalid_tool_arguments(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("get_pricing"), say("Which property?"))
    await engine.handle_turn(state, "price?", "en-IN")
    assert "Invalid arguments" in tool_results(llm.calls[-1])[0]["error"]


async def test_llm_failure_fallback_then_escalation(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(RuntimeError("503"))
    r1 = await engine.handle_turn(state, "hello", "en-IN")
    assert "say that once more" in r1.reply and not r1.escalated
    llm.queue(RuntimeError("503"))
    r2 = await engine.handle_turn(state, "hello?", "en-IN")
    assert r2.escalated and (await db.execute(select(EscalationRecord))).scalar_one().reason == "unresolved"


async def test_transcript_persisted(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(say("Hi there"))
    await engine.handle_turn(state, "Hello", "en-IN")
    msgs = (await db.execute(select(ConversationMessage).where(
        ConversationMessage.conversation_id == state.conversation_id).order_by(ConversationMessage.created_at))).scalars().all()
    assert [(m.role, m.content) for m in msgs] == [("user", "Hello"), ("assistant", "Hi there")]


async def test_typed_tamil_detected_by_script(db, llm):
    engine, state = await new_engine(db, "carewell-hospital", llm)
    res = await engine.handle_turn(state, "அப்பாவுக்கு நெஞ்சு வலி", None)
    assert res.language == "ta-IN" and "108" in res.reply


async def test_tool_budget_exhausted_forces_answer_with_tool_choice_none(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(*[call("search_properties", city="Coimbatore") for _ in range(4)], say("Here are the options."))
    res = await engine.handle_turn(state, "2BHK", "en-IN")
    assert res.reply == "Here are the options."
    # Sarvam rejects tool messages without `tools`; the forced final call keeps tools and disables calling.
    assert llm.opts[-1].get("tool_choice") == "none" and llm.tools[-1]


async def test_property_lookup_accepts_name(db, llm):
    engine, state = await new_engine(db, "sunrise-realty", llm)
    llm.queue(call("get_property_details", property_id="Sunrise Greens Villas"), say("ok"))
    await engine.handle_turn(state, "villas details", "en-IN")
    assert tool_results(llm.calls[-1])[0]["locality"] == "Vadavalli"
