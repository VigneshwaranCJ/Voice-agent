import json
import re
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON string


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)

    def assistant_message(self) -> dict:
        msg: dict = {"role": "assistant", "content": self.content or ""}
        if self.tool_calls:
            msg["tool_calls"] = [{"id": c.id, "type": "function",
                                  "function": {"name": c.name, "arguments": c.arguments}} for c in self.tool_calls]
        return msg


class LLMProvider(Protocol):
    async def complete(self, messages: list[dict], tools: list[dict] | None = None, **opts) -> LLMResponse: ...


_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def clean_content(text: str | None) -> str:
    return _THINK.sub("", text or "").strip()


class ThinkFilter:
    """Removes <think>…</think> from streamed text, even when a tag is split across chunks."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.inside = False
        self.pending = ""

    def feed(self, chunk: str) -> str:
        self.pending += chunk
        out = []
        while self.pending:
            tag = self.CLOSE if self.inside else self.OPEN
            i = self.pending.find(tag)
            if i >= 0:
                if not self.inside:
                    out.append(self.pending[:i])
                self.pending = self.pending[i + len(tag):]
                self.inside = not self.inside
                continue
            # Keep a possible partial tag at the end for the next chunk.
            keep = next((k for k in range(min(len(tag) - 1, len(self.pending)), 0, -1)
                         if tag.startswith(self.pending[-k:])), 0)
            if not self.inside:
                out.append(self.pending[:len(self.pending) - keep])
            self.pending = self.pending[len(self.pending) - keep:]
            break
        return "".join(out)

    def flush(self) -> str:
        rest, self.pending = ("" if self.inside else self.pending), ""
        return rest


def parse_openai_message(msg: dict) -> LLMResponse:
    calls = []
    for c in msg.get("tool_calls") or []:
        fn = c.get("function", {})
        args = fn.get("arguments", "{}")
        if not isinstance(args, str):
            args = json.dumps(args)
        calls.append(ToolCall(id=c.get("id") or fn.get("name", "call"), name=fn.get("name", ""), arguments=args))
    return LLMResponse(content=clean_content(msg.get("content")), tool_calls=calls)
