"""Bridges a client audio transport (browser WebSocket now; telephony later) to STT → engine → TTS.

Client → server JSON frames:
  {"type":"audio","data":<b64 PCM16 mono 16 kHz>}   {"type":"text","text":"..."}
  {"type":"playback_done","utterance_id":"..."}     {"type":"stop"}
Server → client JSON frames:
  ready | state(listening|thinking|speaking) | transcript | agent_text | audio | audio_end | interrupt |
  handoff | error | ended
"""

import asyncio
import base64
import contextlib
import uuid
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.manager import AgentBundle
from app.core.config import get_settings
from app.core.logging import log
from app.models import ConversationMessage
from app.orchestration.engine import AgentEngine, greeting_for
from app.orchestration.lifecycle import end_conversation, log_call_event, start_conversation
from app.sarvam.client import SarvamError
from app.sarvam.streaming import RealtimeSTT, stream_tts
from app.voice.voices import speaker_for

STT_LANG_MAP = {"or-IN": "od-IN"}  # realtime STT uses or-IN, TTS uses od-IN

SILENCE_PROMPT = {"en-IN": "Are you still there?", "ta-IN": "நீங்கள் இன்னும் லைனில் இருக்கிறீர்களா?"}
GOODBYE = {"en-IN": "I'll end the call for now. Please call us again anytime. Thank you!",
           "ta-IN": "இப்போது அழைப்பை முடிக்கிறேன். எப்போது வேண்டுமானாலும் மீண்டும் அழையுங்கள். நன்றி!"}


_ACCOUNT_CODES = {"quota_exceeded", "insufficient_quota_error", "invalid_api_key_error", "1003"}


def _is_account_error(ev: dict) -> bool:
    return str(ev.get("code")) in _ACCOUNT_CODES or ev.get("status_code") in (401, 402, 403)


class ClientTransport(Protocol):
    async def send_json(self, data: dict) -> None: ...


class VoiceSession:
    def __init__(self, db: AsyncSession, bundle: AgentBundle, transport: ClientTransport, channel: str = "web_voice",
                 silence_timeout: float = 25.0):
        self.db, self.bundle, self.transport, self.channel = db, bundle, transport, channel
        self.engine = AgentEngine(db, bundle)
        self.stt: RealtimeSTT | None = None
        self.state = None
        self.call = None
        self.turns: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()
        self.speak_task: asyncio.Task | None = None
        self.current_utterance: str | None = None
        self.agent_speaking = False
        self.silence_timeout = silence_timeout
        self._activity = asyncio.Event()
        self._tasks: list[asyncio.Task] = []
        self._closing = False
        self._db_lock = asyncio.Lock()
        self.done = asyncio.Event()
        self._busy = False  # a turn is being processed
        self._stt_reconnects = 0
        self._stt_dead = False
        self._quiet_since = 0.0  # set when the server decides to end the call

    # ---- lifecycle -------------------------------------------------------------------------------------
    async def start(self) -> None:
        async with self._db_lock:
            self.state, self.call = await start_conversation(self.db, self.bundle, self.channel)
        await self.transport.send_json({
            "type": "ready", "conversation_id": self.state.conversation_id, "language": self.state.language,
            "languages": self.bundle.agent.languages, "sarvam_configured": get_settings().sarvam_configured,
            "agent": {"name": self.bundle.agent.name, "persona": self.bundle.config.persona_name},
        })
        if get_settings().sarvam_configured:
            try:
                self.stt = RealtimeSTT(self._on_stt_event)
                await self.stt.connect()
            except Exception as e:
                log.warning("stt_connect_failed", error=str(e))
                await self._error(f"Speech recognition unavailable: {e}. You can still type.")
                self.stt = None
        else:
            await self._error("SARVAM_API_KEY is not configured on the server — voice and AI replies are disabled.")
        self._tasks.append(asyncio.create_task(self._turn_worker()))
        self._tasks.append(asyncio.create_task(self._silence_watchdog()))
        greeting = greeting_for(self.bundle, self.state.language)
        async with self._db_lock:
            await self.engine.record_greeting(self.state, greeting)
        await self._speak(greeting)

    async def close(self, reason: str = "caller_hangup") -> None:
        if self._closing:
            return
        self._closing = True
        await self._cancel_speech(notify=False)
        for t in self._tasks:
            t.cancel()
        # Wait for cancelled tasks to unwind so none is mid-transaction on the shared DB session.
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self.stt:
            await self.stt.close()
        if self.state:
            async with self._db_lock:
                try:
                    await self.db.rollback()
                    await end_conversation(self.db, self.state, self.call, reason)
                except Exception:
                    log.exception("end_conversation_failed", conversation=self.state.conversation_id)

    # ---- inbound from client ---------------------------------------------------------------------------
    async def handle_client_message(self, msg: dict) -> bool:
        """Returns False when the client asked to stop."""
        t = msg.get("type")
        if t == "audio" and self.stt:
            await self.stt.send_audio(base64.b64decode(msg.get("data", "")))
        elif t == "text" and (text := (msg.get("text") or "").strip()):
            self._activity.set()
            if self.agent_speaking:
                await self._barge_in()
            await self.transport.send_json({"type": "transcript", "role": "user", "text": text, "final": True,
                                            "language": None})
            await self.turns.put((text, None))
        elif t == "playback_done" and msg.get("utterance_id") == self.current_utterance:
            self.agent_speaking = False
            await self._state("listening")
        elif t == "stop":
            return False
        return True

    # ---- STT events ------------------------------------------------------------------------------------
    async def _on_stt_event(self, ev: dict) -> None:
        kind = ev.get("event")
        if kind == "vad.speech_start":
            self._activity.set()
            if self.agent_speaking:
                await self._barge_in()
        elif kind == "transcript.partial":
            await self.transport.send_json({"type": "transcript", "role": "user", "text": ev.get("text", ""),
                                            "final": False, "language": ev.get("language")})
        elif kind == "transcript.final":
            text = (ev.get("text") or "").strip()
            lang = STT_LANG_MAP.get(ev.get("language"), ev.get("language"))
            if not text:
                return
            self._activity.set()
            await self.transport.send_json({"type": "transcript", "role": "user", "text": text, "final": True,
                                            "language": lang})
            await self.turns.put((text, lang))
        elif kind == "error":
            self._tasks.append(asyncio.create_task(self._log_event("stt_error", code=ev.get("code"),
                                                                   message=ev.get("message"))))
            if not ev.get("is_fatal") or self._stt_dead:
                return
            if _is_account_error(ev):
                # Credits / key problems won't fix themselves — never retry (avoids a reconnect storm).
                self._stt_dead = True
                self.stt = None
                await self._error(f"Sarvam speech recognition refused: {ev.get('message')}. You can still type.")
                return
            if self._stt_reconnects >= 2:
                self._stt_dead = True
                self.stt = None
                await self._error("Speech recognition keeps disconnecting. You can still type.")
                return
            self._stt_reconnects += 1
            await self._error("Speech recognition disconnected. Reconnecting…")
            await self._reconnect_stt()

    async def _reconnect_stt(self) -> None:
        if self._closing or self._stt_dead:
            return
        try:
            self.stt = RealtimeSTT(self._on_stt_event)
            await self.stt.connect()
        except Exception as e:
            self.stt = None
            await self._error(f"Speech recognition unavailable ({e}). You can type instead.")

    # ---- turns -----------------------------------------------------------------------------------------
    async def _turn_worker(self) -> None:
        while True:
            text, lang = await self.turns.get()
            # Merge any further finals that queued up while we were busy (caller spoke in several bursts).
            while not self.turns.empty():
                more, lang2 = self.turns.get_nowait()
                text, lang = f"{text} {more}", lang2 or lang
            await self._state("thinking")
            self._busy = True
            try:
                async with self._db_lock:
                    prev_lang = self.state.language
                    result = await self.engine.handle_turn(self.state, text, lang)
                    if result.language != prev_lang:
                        await log_call_event(self.db, self.call, "language_switch", **{"from": prev_lang, "to": result.language})
            except Exception as e:
                log.exception("turn_failed")
                await self._error(f"Something went wrong: {type(e).__name__}")
                await self._state("listening")
                continue
            finally:
                self._busy = False
            for ev in result.events:
                await self.transport.send_json(ev)
                async with self._db_lock:
                    await log_call_event(self.db, self.call, ev["type"], **{k: v for k, v in ev.items() if k != "type"})
            await self._speak(result.reply)

    async def _speak(self, text: str) -> None:
        await self._cancel_speech(notify=False)
        uid = uuid.uuid4().hex[:12]
        self.current_utterance = uid
        await self.transport.send_json({"type": "agent_text", "text": text, "language": self.state.language,
                                        "utterance_id": uid})
        if not get_settings().sarvam_configured:
            await self._state("listening")
            return
        self.agent_speaking = True
        await self._state("speaking")
        self.speak_task = asyncio.create_task(self._tts(uid, text, self.state.language))

    async def _tts(self, uid: str, text: str, lang: str) -> None:
        vp = self.bundle.agent.voice_profile
        try:
            async for chunk in stream_tts(text, language_code=lang, speaker=speaker_for(vp.speakers if vp else None, lang),
                                          model=vp.tts_model if vp else None, pace=vp.pace if vp else 1.0,
                                          temperature=vp.temperature if vp else 0.6,
                                          sample_rate=vp.sample_rate if vp else 24000):
                await self.transport.send_json({"type": "audio", "utterance_id": uid, "format": "mp3",
                                                "data": base64.b64encode(chunk).decode()})
            await self.transport.send_json({"type": "audio_end", "utterance_id": uid})
        except asyncio.CancelledError:
            raise
        except (SarvamError, Exception) as e:
            log.warning("tts_failed", error=str(e))
            self.agent_speaking = False
            async with self._db_lock:
                await log_call_event(self.db, self.call, "tts_error", message=str(e)[:300])
            await self._error(f"Voice playback failed ({str(e)[:160]}); showing text instead.")
            await self._state("listening")

    async def _cancel_speech(self, notify: bool) -> None:
        if self.speak_task and not self.speak_task.done():
            self.speak_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.speak_task
        if notify:
            await self.transport.send_json({"type": "interrupt", "utterance_id": self.current_utterance})
        self.agent_speaking = False

    async def _barge_in(self) -> None:
        uid = self.current_utterance
        await self._cancel_speech(notify=True)
        await self._state("listening")
        # Persist in the background so the STT reader is never blocked behind an in-flight LLM turn.
        self._tasks.append(asyncio.create_task(self._log_barge_in(uid)))

    async def _log_barge_in(self, uid: str | None) -> None:
        async with self._db_lock:
            await log_call_event(self.db, self.call, "barge_in", utterance_id=uid)
            # Mark the last assistant message as interrupted for transcript accuracy.
            last = (await self.db.execute(select(ConversationMessage).where(
                ConversationMessage.tenant_id == self.state.tenant_id,
                ConversationMessage.conversation_id == self.state.conversation_id,
                ConversationMessage.role == "assistant").order_by(ConversationMessage.created_at.desc()))).scalars().first()
            if last:
                last.interrupted = True
                await self.db.commit()

    async def _silence_watchdog(self) -> None:
        """Prompt once after `silence_timeout` of caller silence (after the agent stops speaking), then end."""
        loop = asyncio.get_running_loop()
        self._quiet_since = loop.time()
        prompted_at: float | None = None
        while True:
            await asyncio.sleep(min(0.25, self.silence_timeout / 4))
            if self._activity.is_set():  # caller spoke / typed
                self._activity.clear()
                prompted_at = None
                self._quiet_since = loop.time()
                continue
            if self.agent_speaking or not self.turns.empty() or self._busy:
                self._quiet_since = loop.time()
                continue
            if loop.time() - self._quiet_since < self.silence_timeout:
                continue
            lang = self.state.language
            if prompted_at is None:
                prompted_at = loop.time()
                await self._speak(SILENCE_PROMPT.get(lang, SILENCE_PROMPT["en-IN"]))
            else:
                await self._speak(GOODBYE.get(lang, GOODBYE["en-IN"]))
                await asyncio.sleep(6)
                await self.transport.send_json({"type": "ended", "reason": "silence"})
                self.done.set()
                return
            self._quiet_since = loop.time()

    # ---- helpers ---------------------------------------------------------------------------------------
    async def _log_event(self, event_type: str, **payload) -> None:
        async with self._db_lock:
            await log_call_event(self.db, self.call, event_type, **payload)

    async def _state(self, value: str) -> None:
        await self.transport.send_json({"type": "state", "value": value})

    async def _error(self, message: str) -> None:
        await self.transport.send_json({"type": "error", "message": message})
