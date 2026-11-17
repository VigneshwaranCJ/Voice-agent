"""Conversation / call session lifecycle: start, persist, summarise, close."""

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.manager import AgentBundle
from app.context.state import ConversationState, get_state_store
from app.core.logging import log
from app.core.timeutil import as_utc
from app.llm.sarvam import get_llm
from app.models import AnalyticsEvent, CallEvent, CallSession, Conversation


@dataclass(frozen=True)
class CallRef:
    """Plain identifiers for a call. Long-lived sessions hold this instead of an ORM object, which would be
    expired by a rollback and then lazy-load outside the async context."""

    id: str
    tenant_id: str


async def start_conversation(db: AsyncSession, bundle: AgentBundle, channel: str,
                             caller_number: str | None = None) -> tuple[ConversationState, CallRef | None]:
    agent = bundle.agent
    conv = Conversation(tenant_id=agent.tenant_id, agent_id=agent.id, channel=channel, language=agent.default_language)
    db.add(conv)
    await db.flush()
    call = None
    if channel in ("web_voice", "phone"):
        call = CallSession(tenant_id=agent.tenant_id, conversation_id=conv.id, agent_id=agent.id, channel=channel,
                           caller_number=caller_number, answered_at=datetime.now(UTC),
                           recording_consent=False)
        db.add(call)
    db.add(AnalyticsEvent(tenant_id=agent.tenant_id, agent_id=agent.id, conversation_id=conv.id,
                          name="conversation_started", properties={"channel": channel}))
    await db.commit()
    call_ref = CallRef(call.id, call.tenant_id) if call else None
    state = ConversationState(conversation_id=conv.id, tenant_id=agent.tenant_id, agent_id=agent.id, channel=channel,
                              language=agent.default_language, languages_used=[agent.default_language])
    await get_state_store().put(state)
    return state, call_ref


async def log_call_event(db: AsyncSession, call: CallRef | None, event_type: str, **payload) -> None:
    if not call:
        return
    db.add(CallEvent(tenant_id=call.tenant_id, call_session_id=call.id, event_type=event_type, payload=payload))
    await db.commit()


async def summarise(state: ConversationState) -> str | None:
    turns = [m for m in state.history if m.get("role") in ("user", "assistant") and m.get("content")]
    if len(turns) < 2:
        return None
    transcript = "\n".join(f"{m['role']}: {m['content']}" for m in turns[-30:])
    try:
        resp = await get_llm().complete([
            {"role": "system", "content": "Summarise this customer-care call in English in 2-3 sentences for a human "
                                          "executive: caller need, what was done (bookings/leads), and any pending action."},
            {"role": "user", "content": transcript},
        ], max_tokens=200)
        return resp.content or None
    except Exception as e:  # summary is best-effort
        log.warning("summary_failed", error=str(e))
        return None


async def end_conversation(db: AsyncSession, state: ConversationState, call_ref: CallRef | None,
                           reason: str = "caller_hangup") -> None:
    if state.ended:
        return
    state.ended = True
    conv = (await db.execute(select(Conversation).where(
        Conversation.tenant_id == state.tenant_id, Conversation.id == state.conversation_id))).scalar_one()
    now = datetime.now(UTC)
    conv.ended_at = now
    conv.language = state.language
    conv.languages_used = state.languages_used
    conv.intents = state.intents
    conv.customer_id = state.customer_id
    user_turns = sum(1 for m in state.history if m.get("role") == "user")
    if state.escalated:
        conv.status, conv.resolved = "escalated", False
    elif user_turns == 0:
        conv.status = "abandoned"
    else:
        conv.status = "completed"
        conv.resolved = state.consecutive_failures == 0
    conv.summary = await summarise(state)
    call = None
    if call_ref:
        call = (await db.execute(select(CallSession).where(
            CallSession.tenant_id == call_ref.tenant_id, CallSession.id == call_ref.id))).scalar_one_or_none()
    if call:
        call.ended_at = now
        call.duration_seconds = (now - as_utc(call.started_at)).total_seconds()
        call.status = "completed" if user_turns else "missed"
        call.end_reason = reason
    db.add(AnalyticsEvent(tenant_id=state.tenant_id, agent_id=state.agent_id, conversation_id=state.conversation_id,
                          name="conversation_ended", properties={"status": conv.status, "reason": reason,
                                                                 "language": state.language}))
    await db.commit()
    await get_state_store().delete(state.conversation_id)
