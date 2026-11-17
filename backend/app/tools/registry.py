"""Tool registry: validated, tenant-scoped, time-limited, audited tool execution."""

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.state import ConversationState
from app.core.config import get_settings
from app.core.logging import log
from app.models import ToolExecution


@dataclass
class ToolContext:
    """Execution context. tenant_id/agent_id come from the session, NEVER from LLM arguments."""

    db: AsyncSession
    tenant_id: str
    agent_id: str
    state: ConversationState
    business_timezone: str = "Asia/Kolkata"
    events: list[dict] = field(default_factory=list)  # side-channel events (e.g. handoff) for the session

    @property
    def conversation_id(self) -> str:
        return self.state.conversation_id


Handler = Callable[[ToolContext, Any], Awaitable[dict]]


@dataclass
class ToolSpec:
    name: str
    description: str
    params: type[BaseModel]
    handler: Handler
    industry: str = "common"
    requires_confirmation: bool = False
    is_write: bool = False

    def openai_schema(self) -> dict:
        schema = self.params.model_json_schema()
        schema.pop("title", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        schema.setdefault("properties", {})
        return {"type": "function", "function": {
            "name": self.name, "description": self.description, "parameters": schema}}


_REGISTRY: dict[str, ToolSpec] = {}


def tool(name: str, description: str, params: type[BaseModel], *, industry: str = "common",
         requires_confirmation: bool = False, is_write: bool = False):
    def deco(fn: Handler) -> Handler:
        if name in _REGISTRY:
            raise RuntimeError(f"Duplicate tool {name}")
        _REGISTRY[name] = ToolSpec(name, description, params, fn, industry, requires_confirmation, is_write)
        return fn
    return deco


def get_tool(name: str) -> ToolSpec | None:
    return _REGISTRY.get(name)


def all_tools() -> list[ToolSpec]:
    return list(_REGISTRY.values())


def tools_for(enabled: list[str]) -> list[ToolSpec]:
    return [_REGISTRY[n] for n in enabled if n in _REGISTRY]


_YES = re.compile(
    r"\b(yes|yeah|yep|sure|ok|okay|confirm|confirmed|go ahead|correct|right|please do|book it|do it|"
    r"haan|haa|ji|theek|aama|aamaa|sari|seri|pannunga)\b|ஆமா|ஆம்|சரி|உறுதி|பண்ணுங்க|हाँ|हां|ठीक",
    re.IGNORECASE)
_NO = re.compile(r"\b(no|not|don'?t|wait|cancel that|illa|venda|nahi|mat)\b|வேண்டாம்|இல்லை|இல்ல|नहीं", re.IGNORECASE)


def caller_affirmed(state: ConversationState) -> bool:
    """True if the caller's latest utterance (replying to the agent) is a clear "yes" with no negation."""
    h = [m for m in state.history if m.get("role") in ("user", "assistant")]
    if len(h) < 2 or h[-1]["role"] != "user" or h[-2]["role"] != "assistant":
        return False
    said = (h[-1].get("content") or "").strip()
    if _is_question(said):  # "can you confirm the time?" is not a yes
        return False
    return bool(_YES.search(said)) and not _NO.search(said)


_QUESTION = re.compile(
    r"\?|^\s*(can|could|would|will|shall|should|is|are|was|do|does|did|what|when|where|which|who|why|how)\b"
    r"|\b(enna|eppo|eppadi|enga|yaaru|evvalavu|kya|kab|kaise|kahan|kaun)\b"
    r"|என்ன|எப்போ|எப்படி|எங்கே|யார்|எவ்வளவு|क्या|कब|कैसे|कहाँ|कौन",
    re.IGNORECASE)


def _is_question(text: str) -> bool:
    return bool(_QUESTION.search(text))


def _confirmation_ok(ctx: ToolContext, name: str, args: BaseModel) -> bool:
    """A write needing confirmation runs only when the CALLER has confirmed, never on the model's word alone.

    `confirmed=true` is honoured only when the caller's current reply is a clear "yes" to the agent's
    read-back, and the read-back was not first requested by this tool in this same turn. So the model can't
    propose-and-confirm in one go, and can't book on a later turn where the caller didn't say yes.
    """
    signature = json.dumps(args.model_dump(exclude={"confirmed"}), sort_keys=True, default=str)
    state = ctx.state
    pending = state.pending_confirmations.get(name)
    if (getattr(args, "confirmed", False) and caller_affirmed(state)
            and not (pending and pending["turn"] == state.turn_count)):
        return True
    if not pending or pending["args"] != signature or pending["turn"] < state.turn_count:
        state.pending_confirmations[name] = {"turn": state.turn_count, "args": signature}
    return False


async def execute_tool(ctx: ToolContext, name: str, raw_arguments: str | dict, enabled: list[str]) -> dict:
    started = time.perf_counter()
    status, error, result = "success", None, None
    args_dict: dict = {}
    spec = _REGISTRY.get(name)
    try:
        if spec is None or name not in enabled:
            status, error = "denied", f"Tool '{name}' is not available for this agent."
            return {"ok": False, "error": error}
        args_dict = json.loads(raw_arguments or "{}") if isinstance(raw_arguments, str) else dict(raw_arguments)
        args = spec.params.model_validate(args_dict)
        if spec.requires_confirmation and not _confirmation_ok(ctx, name, args):
            status = "needs_confirmation"
            result = {"ok": False, "needs_confirmation": True,
                      "message": "Not done yet. Read these exact details back to the caller and ask them to confirm. "
                                 "Only after the caller says yes in their next reply, call again with the same "
                                 "arguments and confirmed=true. Do not confirm on the caller's behalf."}
            return result
        result = await asyncio.wait_for(spec.handler(ctx, args), timeout=get_settings().tool_timeout_seconds)
        if spec.requires_confirmation:
            ctx.state.pending_confirmations.pop(name, None)
        return result
    except json.JSONDecodeError:
        status, error = "error", "Arguments were not valid JSON."
        return {"ok": False, "error": error}
    except ValidationError as e:
        status, error = "error", "Invalid arguments: " + "; ".join(
            f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors())
        return {"ok": False, "error": error}
    except TimeoutError:
        # The cancelled handler may have left partial, uncommitted writes (or a broken transaction).
        await ctx.db.rollback()
        status, error = "timeout", "The system took too long to respond."
        return {"ok": False, "error": error, "retryable": True}
    except Exception as e:  # business DB / API failure
        await ctx.db.rollback()
        log.exception("tool_failed", tool=name)
        status, error = "error", f"{type(e).__name__}"
        return {"ok": False, "error": "The business system is temporarily unavailable.", "retryable": True}
    finally:
        try:
            ctx.db.add(ToolExecution(
                tenant_id=ctx.tenant_id, conversation_id=ctx.conversation_id, agent_id=ctx.agent_id,
                tool_name=name, arguments=args_dict, result=result if isinstance(result, dict) else None,
                status=status, error=error, duration_ms=int((time.perf_counter() - started) * 1000),
            ))
            await ctx.db.commit()
        except Exception:  # audit must not break the call
            await ctx.db.rollback()
            log.exception("tool_audit_failed", tool=name)
