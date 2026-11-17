"""Live conversation state (Redis-backed when REDIS_URL is set, in-process otherwise)."""

import json
from typing import Any, Protocol

from pydantic import BaseModel, Field

from app.core.config import get_settings


class ConversationState(BaseModel):
    conversation_id: str
    tenant_id: str
    agent_id: str
    channel: str = "web_voice"
    language: str = "en-IN"
    languages_used: list[str] = Field(default_factory=list)
    # OpenAI-format messages (user / assistant / tool), trimmed to history_max_messages.
    history: list[dict[str, Any]] = Field(default_factory=list)
    customer_id: str | None = None
    customer_verified: bool = False
    collected: dict[str, Any] = Field(default_factory=dict)  # slots gathered so far
    intents: list[str] = Field(default_factory=list)
    escalated: bool = False
    escalation_reason: str | None = None
    consecutive_failures: int = 0
    # tool name -> {"turn": n, "args": canonical args} awaiting the caller's yes (see tools.registry)
    pending_confirmations: dict[str, dict[str, Any]] = Field(default_factory=dict)
    turn_count: int = 0
    ended: bool = False


class StateStore(Protocol):
    async def get(self, conversation_id: str) -> ConversationState | None: ...
    async def put(self, state: ConversationState) -> None: ...
    async def delete(self, conversation_id: str) -> None: ...


class MemoryStateStore:
    def __init__(self) -> None:
        self._data: dict[str, str] = {}

    async def get(self, conversation_id: str) -> ConversationState | None:
        raw = self._data.get(conversation_id)
        return ConversationState.model_validate_json(raw) if raw else None

    async def put(self, state: ConversationState) -> None:
        self._data[state.conversation_id] = state.model_dump_json()

    async def delete(self, conversation_id: str) -> None:
        self._data.pop(conversation_id, None)


class RedisStateStore:
    TTL = 60 * 60 * 6

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._r = redis.from_url(url, decode_responses=True)

    def _key(self, cid: str) -> str:
        return f"conv:{cid}"

    async def get(self, conversation_id: str) -> ConversationState | None:
        raw = await self._r.get(self._key(conversation_id))
        return ConversationState.model_validate(json.loads(raw)) if raw else None

    async def put(self, state: ConversationState) -> None:
        await self._r.set(self._key(state.conversation_id), state.model_dump_json(), ex=self.TTL)

    async def delete(self, conversation_id: str) -> None:
        await self._r.delete(self._key(conversation_id))


_store: StateStore | None = None


def get_state_store() -> StateStore:
    global _store
    if _store is None:
        url = get_settings().redis_url
        _store = RedisStateStore(url) if url else MemoryStateStore()
    return _store
