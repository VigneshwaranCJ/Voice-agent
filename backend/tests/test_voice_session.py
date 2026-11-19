"""VoiceSession: STT events → engine → TTS, barge-in, language detection, persistence."""

import asyncio

import pytest
from sqlalchemy import select

import app.voice.session as vs
from app.context.manager import load_agent_bundle
from app.core.config import get_settings
from app.models import CallEvent, CallSession, Conversation, ConversationMessage
from tests.conftest import agent_for, say


class FakeTransport:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data):
        self.sent.append(data)

    def types(self):
        return [m["type"] for m in self.sent]


class FakeSTT:
    instances: list["FakeSTT"] = []

    def __init__(self, on_event, **kw):
        self.on_event, self.audio = on_event, []
        FakeSTT.instances.append(self)

    async def connect(self):
        pass

    async def send_audio(self, pcm):
        self.audio.append(pcm)

    async def close(self):
        pass


@pytest.fixture
def voice_env(monkeypatch):
    FakeSTT.instances.clear()
    monkeypatch.setattr(get_settings(), "sarvam_api_key", "test-key")
    monkeypatch.setattr(vs, "RealtimeSTT", FakeSTT)
    spoken: list[tuple[str, str, str]] = []

    async def fake_tts(text, *, language_code, speaker, **kw):
        spoken.append((text, language_code, speaker))
        for _ in range(20):  # long utterance: ~1s of chunks
            await asyncio.sleep(0.05)
            yield b"\xff\xf3mp3"

    async def fake_tts_live(texts, voice, **kw):
        parts = []
        while (t := await texts.get()) is not None:
            parts.append(t)
        if not parts:
            return
        lang, speaker = voice()
        async for chunk in fake_tts(" ".join(parts), language_code=lang, speaker=speaker):
            yield chunk

    monkeypatch.setattr(vs, "stream_tts", fake_tts)
    monkeypatch.setattr(vs, "stream_tts_live", fake_tts_live)
    return spoken


async def _wait(cond, timeout=3.0):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("condition not met")


async def test_voice_turn_bargein_and_language(db, llm, voice_env):
    agent = await agent_for(db, "sunrise-realty")
    bundle = await load_agent_bundle(db, agent.id)
    t = FakeTransport()
    s = vs.VoiceSession(db, bundle, t, silence_timeout=60)
    await s.start()
    stt = FakeSTT.instances[0]
    assert t.sent[0]["type"] == "ready" and "agent_text" in t.types()
    assert s.agent_speaking  # greeting is being spoken
    await _wait(lambda: any(m["type"] == "audio" for m in t.sent))

    # Caller interrupts the greeting → TTS cancelled, client told to stop playback.
    await stt.on_event({"event": "vad.speech_start", "utterance_idx": 0})
    assert "interrupt" in t.types() and not s.agent_speaking

    # Caller speaks Tamil; detected language drives reply language and TTS voice.
    llm.queue(say("சரி, உங்கள் budget என்ன?"))
    await stt.on_event({"event": "transcript.final", "utterance_idx": 0, "text": "எனக்கு 2BHK வேணும்",
                        "language": "ta-IN"})
    await _wait(lambda: len(voice_env) == 2)
    assert voice_env[1][1] == "ta-IN" and voice_env[1][2] == "gokul_ta_narration"
    assert voice_env[0][1] == "en-IN" and voice_env[0][2] == "aparna_en_companion"
    await _wait(lambda: any(m["type"] == "audio_end" for m in t.sent))

    # Client reports playback finished → listening.
    await s.handle_client_message({"type": "playback_done", "utterance_id": s.current_utterance})
    assert t.sent[-1] == {"type": "state", "value": "listening"}

    # Mic audio is forwarded to STT.
    await s.handle_client_message({"type": "audio", "data": "AAAA"})
    assert stt.audio == [b"\x00\x00\x00"]

    await s.close("caller_hangup")
    conv = (await db.execute(select(Conversation))).scalar_one()
    assert conv.status == "completed" and conv.languages_used == ["en-IN", "ta-IN"]
    call = (await db.execute(select(CallSession))).scalar_one()
    assert call.status == "completed" and call.duration_seconds is not None
    events = [e.event_type for e in (await db.execute(select(CallEvent))).scalars().all()]
    assert "barge_in" in events and "language_switch" in events
    greeting = (await db.execute(select(ConversationMessage).where(ConversationMessage.role == "assistant")
                                 .order_by(ConversationMessage.created_at))).scalars().first()
    assert greeting.interrupted is True


async def test_voice_handoff_event(db, llm, voice_env):
    agent = await agent_for(db, "carewell-hospital")
    bundle = await load_agent_bundle(db, agent.id)
    t = FakeTransport()
    s = vs.VoiceSession(db, bundle, t, silence_timeout=60)
    await s.start()
    await FakeSTT.instances[0].on_event({"event": "transcript.final", "text": "he is unconscious, not breathing",
                                         "language": "en-IN"})
    await _wait(lambda: "handoff" in t.types())
    handoff = next(m for m in t.sent if m["type"] == "handoff")
    assert handoff["reason"] == "emergency"
    await s.close()
    assert (await db.execute(select(Conversation))).scalar_one().status == "escalated"


async def test_silence_prompts_then_ends(db, llm, voice_env):
    agent = await agent_for(db, "sunrise-realty")
    bundle = await load_agent_bundle(db, agent.id)
    t = FakeTransport()
    s = vs.VoiceSession(db, bundle, t, silence_timeout=0.3)
    await s.start()
    await s.handle_client_message({"type": "playback_done", "utterance_id": s.current_utterance})
    await _wait(lambda: any(m.get("text") == "Are you still there?" for m in t.sent), timeout=3)
    await s.handle_client_message({"type": "playback_done", "utterance_id": s.current_utterance})
    vs_goodbye = vs.GOODBYE["en-IN"]
    await _wait(lambda: any(m.get("text") == vs_goodbye for m in t.sent), timeout=3)
    await s.close("silence_timeout")


async def test_quota_error_does_not_reconnect(db, llm, voice_env):
    agent = await agent_for(db, "sunrise-realty")
    bundle = await load_agent_bundle(db, agent.id)
    t = FakeTransport()
    s = vs.VoiceSession(db, bundle, t, silence_timeout=60)
    await s.start()
    for _ in range(3):  # Sarvam sends an error event and then closes with 1003
        await FakeSTT.instances[0].on_event({"event": "error", "code": "quota_exceeded", "is_fatal": True,
                                             "status_code": 402, "message": "Credits exhausted."})
    assert len(FakeSTT.instances) == 1 and s.stt is None
    errors = [m["message"] for m in t.sent if m["type"] == "error"]
    assert len(errors) == 1 and "Credits exhausted" in errors[0]
    await s.close()


async def test_transient_stt_error_reconnects_at_most_twice(db, llm, voice_env):
    agent = await agent_for(db, "sunrise-realty")
    bundle = await load_agent_bundle(db, agent.id)
    s = vs.VoiceSession(db, bundle, FakeTransport(), silence_timeout=60)
    await s.start()
    for _ in range(5):
        await FakeSTT.instances[-1].on_event({"event": "error", "code": "1011", "is_fatal": True, "message": "server"})
    assert len(FakeSTT.instances) == 3  # original + 2 retries
    await s.close()
