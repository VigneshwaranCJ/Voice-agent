from collections.abc import AsyncIterator

from app.llm.base import LLMResponse, ThinkFilter, ToolCall, clean_content, parse_openai_message
from app.sarvam.client import SarvamClient, get_sarvam


class SarvamLLM:
    """Sarvam chat completions with function calling (model: sarvam-105b-conversations by default)."""

    def __init__(self, client: SarvamClient | None = None):
        self.client = client or get_sarvam()

    def _args(self, opts: dict) -> dict:
        return dict(model=opts.get("model"), temperature=opts.get("temperature", 0.3),
                    max_tokens=opts.get("max_tokens", 600), reasoning_effort=opts.get("reasoning_effort"),
                    tool_choice=opts.get("tool_choice", "auto"))

    async def complete(self, messages: list[dict], tools: list[dict] | None = None, **opts) -> LLMResponse:
        res = await self.client.chat(messages, tools=tools, **self._args(opts))
        choice = (res.get("choices") or [{}])[0]
        return parse_openai_message(choice.get("message") or {})

    async def stream(self, messages: list[dict], tools: list[dict] | None = None, **opts) -> AsyncIterator[str | LLMResponse]:
        """Yield reply text as it is generated, then the complete LLMResponse (with any tool calls) last."""
        think = ThinkFilter()
        content: list[str] = []
        calls: dict[int, dict] = {}  # tool-call deltas arrive in pieces, keyed by index
        async for chunk in self.client.chat_stream(messages, tools=tools, **self._args(opts)):
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    text = think.feed(delta["content"])
                    if text:
                        content.append(text)
                        yield text
                for tc in delta.get("tool_calls") or []:
                    c = calls.setdefault(tc.get("index", 0), {"id": None, "name": "", "arguments": ""})
                    c["id"] = tc.get("id") or c["id"]
                    fn = tc.get("function") or {}
                    c["name"] += fn.get("name") or ""
                    c["arguments"] += fn.get("arguments") or ""
        tail = think.flush()
        if tail:
            content.append(tail)
            yield tail
        tool_calls = [ToolCall(id=c["id"] or c["name"] or f"call_{i}", name=c["name"], arguments=c["arguments"] or "{}")
                      for i, c in sorted(calls.items())]
        yield LLMResponse(content=clean_content("".join(content)), tool_calls=tool_calls)


_llm = None


def get_llm():
    global _llm
    if _llm is None:
        _llm = SarvamLLM()
    return _llm


def set_llm(provider) -> None:
    """Swap provider (tests, alternative vendors)."""
    global _llm
    _llm = provider
