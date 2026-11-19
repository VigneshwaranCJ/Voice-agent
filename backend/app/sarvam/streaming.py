"""Sarvam streaming WebSocket clients.

STT: wss://api.sarvam.ai/speech-to-text-realtime/ws  (VAD endpointing, partial/final transcripts)
TTS: wss://api.sarvam.ai/text-to-speech/ws            (config → text → flush, MP3 chunks)
"""

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from urllib.parse import urlencode

import websockets
from websockets.asyncio.client import ClientConnection

from app.core.config import get_settings
from app.core.logging import log
from app.sarvam.client import SarvamError, SarvamNotConfigured

EventHandler = Callable[[dict], Awaitable[None]]


def _key() -> str:
    key = get_settings().sarvam_api_key
    if not key:
        raise SarvamNotConfigured()
    return key


class RealtimeSTT:
    """Streams 16 kHz mono PCM16 to Sarvam and forwards server events to `on_event`."""

    def __init__(self, on_event: EventHandler, *, language_code: str = "auto", sample_rate: int = 16000,
                 model: str | None = None, silence_duration_ms: int = 600):
        self.on_event = on_event
        self.params = {
            "language_code": language_code,
            "model": model or get_settings().sarvam_stt_model,
            "sample_rate": str(sample_rate),
            "encoding": "linear16",
            "endpointing": "vad",
            "stream_type": "balanced",
            "silence_duration_ms": str(silence_duration_ms),
        }
        self.ws: ClientConnection | None = None
        self._reader: asyncio.Task | None = None
        self.closed = asyncio.Event()

    async def connect(self) -> None:
        url = f"{get_settings().sarvam_ws_base_url}/speech-to-text-realtime/ws?{urlencode(self.params)}"
        self.ws = await websockets.connect(url, additional_headers={"api-subscription-key": _key()},
                                           max_size=2**22, open_timeout=10, ping_interval=20)
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self.ws
        try:
            async for raw in self.ws:
                try:
                    await self.on_event(json.loads(raw))
                except Exception:
                    log.exception("stt_event_handler_failed")
        except websockets.ConnectionClosed as e:
            log.info("stt_closed", code=e.code, reason=e.reason)
            if e.code not in (1000, 1001):
                await self.on_event({"event": "error", "is_fatal": True, "code": str(e.code),
                                     "message": e.reason or "STT connection closed"})
        finally:
            self.closed.set()

    async def send_audio(self, pcm16: bytes) -> None:
        if self.ws and not self.closed.is_set():
            await self.ws.send(json.dumps({"event": "audio_input", "audio": base64.b64encode(pcm16).decode()}))

    async def update_language(self, language_code: str) -> None:
        if self.ws and not self.closed.is_set():
            await self.ws.send(json.dumps({"event": "config.update", "language_code": language_code}))

    async def close(self) -> None:
        if self.ws and not self.closed.is_set():
            try:
                await self.ws.send(json.dumps({"event": "end"}))
                await asyncio.wait_for(self.closed.wait(), timeout=2)
            except Exception:
                pass
            await self.ws.close()
        if self._reader:
            self._reader.cancel()


async def stream_tts(text: str, *, language_code: str, speaker: str, model: str | None = None,
                     pace: float = 1.0, temperature: float = 0.6, sample_rate: int = 24000) -> AsyncIterator[bytes]:
    """Yield MP3 chunks for `text`. Cancel the consuming task to stop (barge-in) — the socket is closed."""
    s = get_settings()
    model = model or s.sarvam_tts_model
    url = f"{s.sarvam_ws_base_url}/text-to-speech/ws?{urlencode({'model': model, 'send_completion_event': 'true'})}"
    async with websockets.connect(url, additional_headers={"api-subscription-key": _key()},
                                  max_size=2**23, open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "config", "data": {
            "model": model, "language_code": language_code, "speaker": speaker, "pace": pace,
            "temperature": temperature, "speech_sample_rate": str(sample_rate),
            "output_audio_codec": "mp3", "output_audio_bitrate": "64k",
            "min_buffer_size": 30, "max_chunk_length": 200,
        }}))
        await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
        await ws.send(json.dumps({"type": "flush"}))
        async for raw in ws:
            msg = json.loads(raw)
            t = msg.get("type")
            if t == "audio":
                yield base64.b64decode(msg["data"]["audio"])
            elif t == "event" and msg.get("data", {}).get("event_type") == "final":
                return
            elif t == "error":
                d = msg.get("data", {})
                raise SarvamError(d.get("message", "TTS error"), code=str(d.get("code")))


async def stream_tts_live(texts: "asyncio.Queue[str | None]", voice: Callable[[], tuple[str, str]], *,
                          model: str | None = None, pace: float = 1.0, temperature: float = 0.6,
                          sample_rate: int = 24000) -> AsyncIterator[bytes]:
    """Yield MP3 chunks while text is still arriving.

    The socket is opened at once (overlapping the LLM's thinking time), but the voice config is sent only when the
    first text arrives: `voice()` then returns the (language_code, speaker) for this turn, which may have changed
    if the caller switched language. Put text pieces on `texts`, then None to finish. Cancel the consumer to stop.
    """
    s = get_settings()
    model = model or s.sarvam_tts_model
    url = f"{s.sarvam_ws_base_url}/text-to-speech/ws?{urlencode({'model': model, 'send_completion_event': 'true'})}"

    async def configure(ws: ClientConnection, language_code: str, speaker: str) -> None:
        await ws.send(json.dumps({"type": "config", "data": {
            "model": model, "language_code": language_code, "speaker": speaker, "pace": pace,
            "temperature": temperature, "speech_sample_rate": str(sample_rate),
            "output_audio_codec": "mp3", "output_audio_bitrate": "64k",
            "min_buffer_size": 30, "max_chunk_length": 200,
        }}))

    async with websockets.connect(url, additional_headers={"api-subscription-key": _key()},
                                  max_size=2**23, open_timeout=10) as ws:
        first = await texts.get()
        if first is None:  # nothing to say
            return
        try:
            await configure(ws, *voice())
        except websockets.ConnectionClosed:
            # The idle socket was closed while the LLM was thinking (e.g. a long tool call): speak this turn on a
            # fresh connection instead.
            async for chunk in _speak_rest(first, texts, voice, model=model, pace=pace, temperature=temperature,
                                           sample_rate=sample_rate):
                yield chunk
            return

        async def pump() -> None:
            await ws.send(json.dumps({"type": "text", "data": {"text": first}}))
            while (t := await texts.get()) is not None:
                await ws.send(json.dumps({"type": "text", "data": {"text": t}}))
            await ws.send(json.dumps({"type": "flush"}))

        sender = asyncio.create_task(pump())
        try:
            async for raw in ws:
                msg = json.loads(raw)
                t = msg.get("type")
                if t == "audio":
                    yield base64.b64decode(msg["data"]["audio"])
                elif t == "event" and msg.get("data", {}).get("event_type") == "final":
                    if sender.done():  # final for the flushed (complete) text
                        return
                elif t == "error":
                    d = msg.get("data", {})
                    raise SarvamError(d.get("message", "TTS error"), code=str(d.get("code")))
        finally:
            sender.cancel()


async def _speak_rest(first: str, texts: "asyncio.Queue[str | None]", voice: Callable[[], tuple[str, str]],
                      **kw) -> AsyncIterator[bytes]:
    rest = [first]
    while (t := await texts.get()) is not None:
        rest.append(t)
    language_code, speaker = voice()
    async for chunk in stream_tts(" ".join(rest), language_code=language_code, speaker=speaker, **kw):
        yield chunk
