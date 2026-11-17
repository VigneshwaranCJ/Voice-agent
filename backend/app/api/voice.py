"""Web voice channel (WebSocket), text test console, and public widget sessions."""

import asyncio
import contextlib

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.manager import load_agent_bundle
from app.context.state import get_state_store
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.llm.sarvam import SarvamLLM, get_llm
from app.core.deps import DB, Principal, tenant_scope
from app.core.logging import log
from app.models import Agent, Conversation
from app.orchestration.engine import AgentEngine, greeting_for
from app.orchestration.lifecycle import end_conversation, start_conversation
from app.schemas.api import ChatIn, ChatOut
from app.security.crypto import create_access_token, decode_token
from app.voice.session import VoiceSession

router = APIRouter(tags=["voice"])


@router.post("/public/agents/{agent_id}/session")
async def widget_session(agent_id: str, db: AsyncSession = DB):
    """Short-lived token for the website widget. Only for agents with public_widget_enabled."""
    a = (await db.execute(select(Agent).where(Agent.id == agent_id, Agent.is_active.is_(True)))).unique().scalar_one_or_none()
    if not a or not a.public_widget_enabled:
        raise HTTPException(404, "Agent not available")
    token = create_access_token(user_id=f"widget:{agent_id}", tenant_id=a.tenant_id, role="widget",
                                extra={"kind": "widget", "aid": agent_id}, expires_minutes=15)
    return {"token": token, "agent": {"id": a.id, "name": a.name, "languages": a.languages}}


@router.post("/agents/{agent_id}/voice-ticket")
async def voice_ticket(agent_id: str, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    """One-minute ticket for opening the voice WebSocket from the dashboard.

    Browsers can't set headers on a WebSocket, so the credential travels in the URL — where proxies and
    access logs record it. A ticket bound to one agent that expires in a minute is safe to leak; the
    user's long-lived JWT is not, so it is never accepted on the socket.
    """
    a = (await db.execute(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == p.tenant_id))).unique().scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Agent not found")
    ticket = create_access_token(user_id=p.user_id, tenant_id=a.tenant_id, role="ws",
                                 extra={"kind": "ws", "aid": a.id}, expires_minutes=1)
    return {"ticket": ticket}


def _authorize_ws(token: str, agent: Agent) -> bool:
    """Only widget sessions and voice tickets open the socket — both bound to this exact agent."""
    try:
        c = decode_token(token)
    except Exception:
        return False
    return c.get("kind") in ("widget", "ws") and c.get("aid") == agent.id and c.get("tid") == agent.tenant_id


class _WSTransport:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.lock = asyncio.Lock()
        self.open = True

    async def send_json(self, data: dict) -> None:
        if not self.open:
            return
        async with self.lock:
            try:
                await self.ws.send_json(data)
            except Exception:
                self.open = False


@router.websocket("/voice/ws")
async def voice_ws(ws: WebSocket, agent_id: str = Query(...), token: str = Query(...)):
    await ws.accept()
    async with SessionLocal() as db:
        bundle = await load_agent_bundle(db, agent_id)
        if not bundle or not _authorize_ws(token, bundle.agent):
            await ws.send_json({"type": "error", "message": "Unauthorized or unknown agent"})
            await ws.close(code=4401)
            return
        transport = _WSTransport(ws)
        session = VoiceSession(db, bundle, transport)
        reason = "caller_hangup"
        try:
            await session.start()
            while True:
                recv = asyncio.create_task(ws.receive_json())
                done_wait = asyncio.create_task(session.done.wait())
                finished, _ = await asyncio.wait({recv, done_wait}, return_when=asyncio.FIRST_COMPLETED)
                if done_wait in finished:
                    recv.cancel()
                    reason = "silence_timeout"
                    break
                done_wait.cancel()
                if not await session.handle_client_message(recv.result()):
                    break
        except WebSocketDisconnect:
            reason = "disconnected"
        except Exception:
            log.exception("voice_ws_failed")
            reason = "server_error"
        finally:
            transport.open = False
            await session.close(reason)
            with contextlib.suppress(Exception):
                await ws.close()


@router.post("/agents/{agent_id}/chat", response_model=ChatOut)
async def chat(agent_id: str, body: ChatIn, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    """Text test console: same engine, tools and guardrails as voice, without audio."""
    bundle = await load_agent_bundle(db, agent_id, tenant_id=p.tenant_id)
    if not bundle:
        raise HTTPException(404, "Agent not found")
    if isinstance(get_llm(), SarvamLLM) and not get_settings().sarvam_configured:
        raise HTTPException(503, "SARVAM_API_KEY is not configured on the server")
    store = get_state_store()
    state = await store.get(body.conversation_id) if body.conversation_id else None
    if state and state.tenant_id != p.tenant_id:
        raise HTTPException(404, "Conversation not found")
    engine = AgentEngine(db, bundle)
    if not state:
        state, _ = await start_conversation(db, bundle, "web_text")
        if body.language:
            state.language = body.language
        await engine.record_greeting(state, greeting_for(bundle, state.language))
    result = await engine.handle_turn(state, body.text, body.language)
    return ChatOut(conversation_id=state.conversation_id, reply=result.reply, language=result.language,
                   events=result.events, tool_calls=result.tool_calls, escalated=result.escalated)


@router.post("/conversations/{conv_id}/end")
async def end_chat(conv_id: str, p: Principal = Depends(tenant_scope), db: AsyncSession = DB):
    state = await get_state_store().get(conv_id)
    if not state or state.tenant_id != p.tenant_id:
        conv = (await db.execute(select(Conversation).where(Conversation.tenant_id == p.tenant_id,
                                                            Conversation.id == conv_id))).scalar_one_or_none()
        if not conv:
            raise HTTPException(404, "Conversation not found")
        return {"ok": True, "already_ended": True}
    await end_conversation(db, state, None, "ended_by_user")
    return {"ok": True}
