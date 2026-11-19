"""Sarvam AI REST client (STT, TTS, chat completions). Docs: https://docs.sarvam.ai"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import log


class SarvamError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status, self.code = status, code


class SarvamNotConfigured(SarvamError):
    def __init__(self) -> None:
        super().__init__("SARVAM_API_KEY is not configured", code="not_configured")


_RETRY_STATUS = {429, 500, 502, 503}


class SarvamClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 30.0):
        s = get_settings()
        self.api_key = api_key or s.sarvam_api_key
        self.base_url = (base_url or s.sarvam_base_url).rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise SarvamNotConfigured()
        # Chat V1 documents Bearer auth too; STT/TTS use api-subscription-key.
        return {"api-subscription-key": self.api_key, "Authorization": f"Bearer {self.api_key}"}

    async def _request(self, method: str, path: str, *, retries: int = 2, **kw) -> dict:
        headers = self._headers()
        delay = 0.5
        for attempt in range(retries + 1):
            try:
                r = await self._client.request(method, f"{self.base_url}{path}", headers=headers, **kw)
            except httpx.TransportError as e:
                if attempt < retries:
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                raise SarvamError(f"Network error contacting Sarvam: {e}") from e
            if r.status_code in _RETRY_STATUS and attempt < retries:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            if r.status_code >= 400:
                try:
                    err = r.json().get("error", {})
                except ValueError:
                    err = {}
                log.warning("sarvam_error", path=path, status=r.status_code, body=r.text[:500])
                raise SarvamError(err.get("message") or r.text[:300], r.status_code, err.get("code"))
            return r.json()
        raise SarvamError("unreachable")

    async def speech_to_text(self, audio: bytes, filename: str = "audio.wav", language_code: str = "unknown",
                             model: str | None = None) -> dict:
        data = {"model": model or get_settings().sarvam_stt_model, "language_code": language_code}
        files = {"file": (filename, audio)}
        return await self._request("POST", "/speech-to-text", data=data, files=files)

    async def text_to_speech(self, text: str, language_code: str, speaker: str | None, *, model: str | None = None,
                             pace: float = 1.0, sample_rate: int = 24000, codec: str = "mp3",
                             temperature: float = 0.6) -> bytes:
        import base64

        body: dict[str, Any] = {"text": text, "language_code": language_code,
                                "model": model or get_settings().sarvam_tts_model, "pace": pace,
                                "speech_sample_rate": sample_rate, "output_audio_codec": codec,
                                "temperature": temperature}
        if speaker:
            body["speaker"] = speaker
        res = await self._request("POST", "/text-to-speech", json=body)
        return b"".join(base64.b64decode(a) for a in res.get("audios", []))

    async def chat(self, messages: list[dict], *, tools: list[dict] | None = None, model: str | None = None,
                   temperature: float = 0.3, max_tokens: int = 600, reasoning_effort: str | None = None,
                   tool_choice: str = "auto") -> dict:
        s = get_settings()
        body: dict[str, Any] = {"model": model or s.sarvam_llm_model, "messages": messages,
                                "temperature": temperature, "max_tokens": max_tokens}
        if reasoning_effort or s.sarvam_llm_reasoning_effort:
            body["reasoning_effort"] = reasoning_effort or s.sarvam_llm_reasoning_effort
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice
        return await self._request("POST", "/v1/chat/completions", json=body, timeout=s.llm_timeout_seconds)

    async def chat_stream(self, messages: list[dict], *, tools: list[dict] | None = None, model: str | None = None,
                          temperature: float = 0.3, max_tokens: int = 600, reasoning_effort: str | None = None,
                          tool_choice: str = "auto") -> AsyncIterator[dict]:
        """Chat completions with `stream: true`: yields each server-sent JSON chunk (OpenAI format)."""
        s = get_settings()
        body: dict[str, Any] = {"model": model or s.sarvam_llm_model, "messages": messages, "stream": True,
                                "temperature": temperature, "max_tokens": max_tokens}
        if reasoning_effort or s.sarvam_llm_reasoning_effort:
            body["reasoning_effort"] = reasoning_effort or s.sarvam_llm_reasoning_effort
        if tools:
            body["tools"] = tools
            body["tool_choice"] = tool_choice
        try:
            async with self._client.stream("POST", f"{self.base_url}/v1/chat/completions", json=body,
                                           headers=self._headers(), timeout=s.llm_timeout_seconds) as r:
                if r.status_code >= 400:
                    raw = (await r.aread()).decode("utf-8", "replace")
                    try:
                        err = json.loads(raw).get("error", {})
                    except ValueError:
                        err = {}
                    log.warning("sarvam_error", path="/v1/chat/completions(stream)", status=r.status_code, body=raw[:500])
                    raise SarvamError(err.get("message") or raw[:300], r.status_code, err.get("code"))
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    if data:
                        yield json.loads(data)
        except httpx.TransportError as e:
            raise SarvamError(f"Network error contacting Sarvam: {e}") from e

    async def aclose(self) -> None:
        await self._client.aclose()


_client: SarvamClient | None = None


def get_sarvam() -> SarvamClient:
    global _client
    if _client is None:
        _client = SarvamClient()
    return _client
