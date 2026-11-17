from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, Principal, tenant_scope
from app.models import (
    Appointment, CallEvent, CallSession, Conversation, ConversationMessage, EscalationRecord, Lead, ToolExecution,
)
from app.schemas.api import ConversationOut, MessageOut

router = APIRouter(tags=["calls"])


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(agent_id: str | None = None, status: str | None = None,
                             limit: int = Query(50, le=200), offset: int = 0,
                             p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    q = select(Conversation).where(Conversation.tenant_id == p.tenant_id)
    if agent_id:
        q = q.where(Conversation.agent_id == agent_id)
    if status:
        q = q.where(Conversation.status == status)
    return (await db.execute(q.order_by(Conversation.created_at.desc()).limit(limit).offset(offset))).scalars().all()


@router.get("/conversations/{conv_id}")
async def conversation_detail(conv_id: str, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    conv = (await db.execute(select(Conversation).where(Conversation.tenant_id == p.tenant_id,
                                                        Conversation.id == conv_id))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, "Conversation not found")
    msgs = (await db.execute(select(ConversationMessage).where(
        ConversationMessage.tenant_id == p.tenant_id, ConversationMessage.conversation_id == conv_id)
        .order_by(ConversationMessage.created_at))).scalars().all()
    tools = (await db.execute(select(ToolExecution).where(
        ToolExecution.tenant_id == p.tenant_id, ToolExecution.conversation_id == conv_id)
        .order_by(ToolExecution.created_at))).scalars().all()
    escalations = (await db.execute(select(EscalationRecord).where(
        EscalationRecord.tenant_id == p.tenant_id, EscalationRecord.conversation_id == conv_id))).scalars().all()
    call = (await db.execute(select(CallSession).where(
        CallSession.tenant_id == p.tenant_id, CallSession.conversation_id == conv_id))).scalar_one_or_none()
    events = []
    if call:
        events = (await db.execute(select(CallEvent).where(CallEvent.tenant_id == p.tenant_id,
                                                           CallEvent.call_session_id == call.id)
                                   .order_by(CallEvent.created_at))).scalars().all()
    return {
        "conversation": ConversationOut.model_validate(conv),
        "messages": [MessageOut.model_validate(m) for m in msgs],
        "tool_executions": [{"tool": t.tool_name, "status": t.status, "arguments": t.arguments, "result": t.result,
                             "error": t.error, "duration_ms": t.duration_ms, "at": t.created_at} for t in tools],
        "escalations": [{"id": e.id, "reason": e.reason, "priority": e.priority, "summary": e.summary,
                         "status": e.status, "at": e.created_at} for e in escalations],
        "call": {"duration_seconds": call.duration_seconds, "status": call.status, "end_reason": call.end_reason,
                 "recording_consent": call.recording_consent} if call else None,
        "call_events": [{"type": e.event_type, "payload": e.payload, "at": e.created_at} for e in events],
    }


@router.get("/escalations")
async def list_escalations(status: str | None = None, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    q = select(EscalationRecord).where(EscalationRecord.tenant_id == p.tenant_id)
    if status:
        q = q.where(EscalationRecord.status == status)
    rows = (await db.execute(q.order_by(EscalationRecord.created_at.desc()).limit(100))).scalars().all()
    return [{"id": e.id, "conversation_id": e.conversation_id, "reason": e.reason, "priority": e.priority,
             "summary": e.summary, "status": e.status, "context": e.context, "at": e.created_at} for e in rows]


@router.get("/leads")
async def list_leads(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(Lead).where(Lead.tenant_id == p.tenant_id)
                             .order_by(Lead.created_at.desc()).limit(200))).scalars().all()
    return [{"id": r.id, "name": r.name, "phone": r.phone, "interest": r.interest, "budget": r.budget,
             "status": r.status, "assigned_to": r.assigned_to, "at": r.created_at} for r in rows]


@router.get("/appointments")
async def list_appointments(p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    rows = (await db.execute(select(Appointment).where(Appointment.tenant_id == p.tenant_id)
                             .order_by(Appointment.starts_at.desc()).limit(200))).scalars().all()
    return [{"id": r.id, "kind": r.kind, "resource_type": r.resource_type, "resource_id": r.resource_id,
             "starts_at": r.starts_at, "status": r.status, "contact_name": r.contact_name,
             "contact_phone": r.contact_phone, "notes": r.notes} for r in rows]


@router.get("/analytics/overview")
async def analytics_overview(days: int = Query(30, le=365), p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    since = datetime.now(UTC) - timedelta(days=days)
    t = p.tenant_id
    conv_base = select(Conversation).where(Conversation.tenant_id == t, Conversation.created_at >= since).subquery()

    async def scalar(q):
        return (await db.execute(q)).scalar() or 0

    total = await scalar(select(func.count()).select_from(conv_base))
    by_status = dict((await db.execute(select(conv_base.c.status, func.count()).group_by(conv_base.c.status))).all())
    by_lang = dict((await db.execute(select(conv_base.c.language, func.count()).group_by(conv_base.c.language))).all())
    by_channel = dict((await db.execute(select(conv_base.c.channel, func.count()).group_by(conv_base.c.channel))).all())
    resolved = await scalar(select(func.count()).select_from(conv_base).where(conv_base.c.resolved.is_(True)))
    calls = select(CallSession).where(CallSession.tenant_id == t, CallSession.started_at >= since).subquery()
    call_total = await scalar(select(func.count()).select_from(calls))
    missed = await scalar(select(func.count()).select_from(calls).where(calls.c.status == "missed"))
    avg_dur = await scalar(select(func.avg(calls.c.duration_seconds)))
    csat = await scalar(select(func.avg(conv_base.c.satisfaction)))
    tools = (await db.execute(select(ToolExecution.tool_name, func.count()).where(
        ToolExecution.tenant_id == t, ToolExecution.created_at >= since).group_by(ToolExecution.tool_name)
        .order_by(func.count().desc()).limit(10))).all()
    daily = (await db.execute(select(func.date(conv_base.c.created_at), func.count())
                              .group_by(func.date(conv_base.c.created_at)).order_by(func.date(conv_base.c.created_at)))).all()
    ended = sum(v for k, v in by_status.items() if k != "active")
    return {
        "days": days, "total_conversations": total, "total_calls": call_total,
        "answered_calls": call_total - missed, "missed_calls": missed,
        "avg_call_duration_seconds": round(float(avg_dur), 1) if avg_dur else 0,
        "resolved": resolved, "resolution_rate": round(resolved / ended, 3) if ended else None,
        "escalated": by_status.get("escalated", 0), "by_status": by_status,
        "languages": {k or "unknown": v for k, v in by_lang.items()}, "channels": by_channel,
        "customer_satisfaction": round(float(csat), 2) if csat else None,
        "top_tools": [{"tool": n, "count": c} for n, c in tools],
        "daily": [{"date": str(d), "count": c} for d, c in daily],
    }
