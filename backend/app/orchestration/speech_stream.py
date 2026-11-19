"""Turns a stream of LLM text into speakable chunks (whole sentences), so speech can start before the reply ends."""

import re
from collections.abc import Awaitable, Callable

# A sentence ends at . ! ? (or Devanagari । ॥) followed by whitespace, or at a newline. Requiring the following
# space avoids cutting "5.5" or "Dr.Rao" mid-token; the last sentence is flushed when the reply ends.
_END = re.compile(r"[.!?।॥](?=\s)|\n")
SOFT_LIMIT = 120  # past this, also break at a comma
HARD_LIMIT = 220  # never hold more than this before speaking (break at the last space)


def _cut(buf: str) -> int:
    m = _END.search(buf)
    if m:
        return m.end()
    if len(buf) >= SOFT_LIMIT:
        i = buf.rfind(", ", 0, HARD_LIMIT)
        if i > 0:
            return i + 1
    if len(buf) >= HARD_LIMIT:
        i = buf.rfind(" ", 0, HARD_LIMIT)
        return i if i > 0 else HARD_LIMIT
    return 0


class SentenceStream:
    """Buffers streamed text and calls `on_text` once per sentence. `text` is everything that was spoken."""

    def __init__(self, on_text: Callable[[str], Awaitable[None]]):
        self.on_text = on_text
        self.buf = ""
        self.parts: list[str] = []

    @property
    def used(self) -> bool:
        return bool(self.parts)

    @property
    def text(self) -> str:
        return re.sub(r"[ \t]+", " ", "".join(self.parts)).strip()

    async def feed(self, text: str) -> None:
        self.buf += text
        while (cut := _cut(self.buf)) > 0:
            chunk, self.buf = self.buf[:cut], self.buf[cut:]
            await self._emit(chunk)

    async def flush(self) -> None:
        chunk, self.buf = self.buf, ""
        await self._emit(chunk)

    async def say(self, text: str) -> None:
        """Speak a complete piece of text (e.g. a fallback reply) after anything already buffered."""
        await self.flush()
        await self._emit(text if text.startswith(" ") else f" {text}")

    async def _emit(self, chunk: str) -> None:
        if chunk.strip():
            self.parts.append(chunk)
            await self.on_text(chunk.strip())
