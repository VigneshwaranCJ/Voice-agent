"""Streaming replies: SSE parsing, sentence chunking, engine streaming with fallbacks, and the voice pipeline."""

import asyncio
import json

import httpx

import app.voice.session as vs
from app.context.manager import load_agent_bundle
from app.llm.base import LLMResponse, ToolCall
from app.llm.sarvam import SarvamLLM, set_llm
from app.orchestration.speech_stream import SentenceStream
from app.sarvam.client import SarvamClient, SarvamError
from tests.conftest import agent_for, new_engine
from tests.test_voice_session import FakeSTT, FakeTransport, _wait, voice_env  # noqa: F401  (fixture)


class StreamingLLM:
    """Test double with both complete() and stream(). Each scripted turn is a list of text pieces, an
    LLMResponse (e.g. tool calls), or an Exception raised after the given pieces."""

    def __init__(self, *rounds):
        self.rounds = list(rounds)
        self.completes: list[LLMResponse] = []
        self.complete_calls = 0

    async def complete(self, messages, tools=None, **opts):
        self.complete_calls += 1
        return self.completes.pop(0) if self.completes else LLMResponse(content="Fallback answer.")

    async def stream(self, messages, tools=None, **opts):
        item = self.rounds.pop(0)
        if isinstance(item, LLMResponse):
            yield item
            return
        text = ""
        for piece in item:
            if isinstance(piece, Exception):
                raise piece
            text += piece
            yield piece
            await asyncio.sleep(0)
        yield LLMResponse(content=text.strip())


# ---------- sentence chunking ----------

async def test_sentence_stream_cuts_at_sentence_ends_only():
    out: list[str] = []

    async def on(t):
        out.append(t)

    s = SentenceStream(on)
    for piece in ["Price is ₹5", ".5 lakh. Want a", " visit? ", "சரி। ", "Bye"]:
        await s.feed(piece)
    assert out == ["Price is ₹5.5 lakh.", "Want a visit?", "சரி।"]  # "5.5" is not a sentence end
    await s.flush()
    assert out[-1] == "Bye" and s.text == "Price is ₹5.5 lakh. Want a visit? சரி। Bye"


async def test_long_text_without_punctuation_still_streams():
    out: list[str] = []

    async def on(t):
        out.append(t)

    s = SentenceStream(on)
    await s.feed("word " * 60)  # 300 chars, no full stop
    assert out and all(len(c) <= 220 for c in out)


# ---------- SSE parsing ----------

def _sse(*chunks) -> bytes:
    return "".join(f"data: {json.dumps(c)}\n\n" for c in chunks).encode() + b"data: [DONE]\n\n"


def _delta(**d):
    return {"choices": [{"delta": d, "index": 0}]}


async def test_sarvam_stream_parses_text_think_and_split_tool_calls(monkeypatch):
    body = _sse(
        _delta(content="<thi"), _delta(content="nk>plan</think>Hello"), _delta(content=" there."),
        _delta(tool_calls=[{"index": 0, "id": "call-1", "function": {"name": "get_business", "arguments": "{\"a\""}}]),
        _delta(tool_calls=[{"index": 0, "function": {"name": "_info", "arguments": ": 1}"}}]),
        {"choices": [], "usage": {"completion_tokens": 9}},
    )
    client = SarvamClient(api_key="k", base_url="https://sarvam.test")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(
        200, content=body, headers={"content-type": "text/event-stream"})))
    items = [i async for i in SarvamLLM(client).stream([{"role": "user", "content": "hi"}])]
    assert [i for i in items if isinstance(i, str)] == ["Hello", " there."]
    final = items[-1]
    assert final.content == "Hello there."
    assert final.tool_calls == [ToolCall(id="call-1", name="get_business_info", arguments='{"a": 1}')]


async def test_sarvam_stream_http_error_raises():
    client = SarvamClient(api_key="k", base_url="https://sarvam.test")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda req: httpx.Response(402, json={"error": {"message": "out of credits", "code": "quota"}})))
    try:
        [i async for i in SarvamLLM(client).stream([{"role": "user", "content": "hi"}])]
    except SarvamError as e:
        assert e.status == 402 and "credits" in str(e)
    else:
        raise AssertionError("expected SarvamError")


# ---------- engine ----------

async def _collect():
    said: list[str] = []

    async def on(t):
        said.append(t)

    return said, on


async def test_engine_streams_sentences_and_records_full_reply(db):
    llm = StreamingLLM(["We open at 9. ", "We close at 7", " on weekdays."])
    set_llm(llm)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        said, on = await _collect()
        r = await engine.handle_turn(state, "When are you open?", on_text=on)
        assert said == ["We open at 9.", "We close at 7 on weekdays."]
        assert r.streamed and r.reply == "We open at 9. We close at 7 on weekdays."
        assert state.history[-1] == {"role": "assistant", "content": r.reply}
        assert llm.complete_calls == 0
    finally:
        set_llm(None)


async def test_engine_streams_after_a_tool_round(db):
    llm = StreamingLLM(LLMResponse(content="", tool_calls=[ToolCall(id="c1", name="get_business_info", arguments="{}")]),
                       ["Our office is in Coimbatore."])
    set_llm(llm)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        said, on = await _collect()
        r = await engine.handle_turn(state, "Where are you?", on_text=on)
        assert said == ["Our office is in Coimbatore."] and r.streamed
        assert [t["name"] for t in r.tool_calls] == ["get_business_info"]
    finally:
        set_llm(None)


async def test_stream_failure_before_any_speech_falls_back_to_a_normal_request(db):
    llm = StreamingLLM([SarvamError("stream broke")])
    llm.completes.append(LLMResponse(content="Recovered answer."))
    set_llm(llm)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        said, on = await _collect()
        r = await engine.handle_turn(state, "hello", on_text=on)
        assert llm.complete_calls == 1 and r.reply == "Recovered answer."
        assert not r.streamed and said == []  # the session speaks this whole reply itself
    finally:
        set_llm(None)


async def test_stream_failure_mid_answer_continues_with_an_apology(db):
    llm = StreamingLLM(["Sure, the 2BHK is available. ", SarvamError("dropped")])
    set_llm(llm)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        said, on = await _collect()
        r = await engine.handle_turn(state, "Is the 2BHK available?", on_text=on)
        assert said[0] == "Sure, the 2BHK is available." and len(said) == 2  # then the apology
        assert r.streamed and r.reply.startswith("Sure, the 2BHK is available.") and r.reply != said[0]
        assert llm.complete_calls == 0  # never re-asked: the caller already heard part of an answer
    finally:
        set_llm(None)


async def test_text_chat_does_not_stream(db):
    llm = StreamingLLM()
    llm.completes.append(LLMResponse(content="Plain."))
    set_llm(llm)
    try:
        engine, state = await new_engine(db, "sunrise-realty", llm)
        r = await engine.handle_turn(state, "hi")  # no on_text: widget / test chat
        assert r.reply == "Plain." and not r.streamed and llm.complete_calls == 1
    finally:
        set_llm(None)


# ---------- voice pipeline ----------

async def test_voice_turn_speaks_streamed_reply_in_detected_language(db, voice_env):
    llm = StreamingLLM(["சரி. ", "உங்கள் budget என்ன?"])
    set_llm(llm)
    try:
        agent = await agent_for(db, "sunrise-realty")
        bundle = await load_agent_bundle(db, agent.id)
        t = FakeTransport()
        s = vs.VoiceSession(db, bundle, t, silence_timeout=60)
        await s.start()
        stt = FakeSTT.instances[0]
        await _wait(lambda: any(m["type"] == "audio" for m in t.sent))  # greeting is playing
        await stt.on_event({"event": "vad.speech_start", "utterance_idx": 0})  # interrupt the greeting
        await stt.on_event({"event": "transcript.final", "utterance_idx": 0, "text": "எனக்கு 2BHK வேணும்",
                            "language": "ta-IN"})
        await _wait(lambda: len(voice_env) == 2)
        text, lang, speaker = voice_env[1]
        assert text == "சரி. உங்கள் budget என்ன?" and lang == "ta-IN" and speaker == "gokul_ta_narration"
        await _wait(lambda: any(m["type"] == "agent_text" and m["text"] == text for m in t.sent))
        await s.close()
    finally:
        set_llm(None)
