# Codebase review — fixes (2026-11-17)

A full review of the codebase found 10 problems. All 10 are fixed, and each has a regression test in
`backend/tests/test_review_fixes.py` unless noted otherwise.

| # | Severity | Problem | Fix | Where |
|---|---|---|---|---|
| 1 | High | The emergency regex had no word boundaries: "benefits" matched `fits`, so ordinary questions were treated as emergencies and escalated. | English and Tanglish patterns are now word-bounded. Prefix matches are explicit (`suicid\w*`, `mayakk\w*`). Tamil and Devanagari patterns stay unbounded because `\b` is unreliable with combining marks. | `app/industries/healthcare/module.py` |
| 2 | High | `identify_customer` returned the stored name, upcoming appointments and past enquiries to anyone who said a phone number. Anyone could read another person's data. | Returns only `is_new_customer`, `verified: false` and record counts. The system prompt says "NOT verified" and never contains stored personal data. The `collected` name comes only from what the caller said in this call. | `app/tools/common.py`, `app/context/manager.py` |
| 3 | High | When a tool failed, `rollback()` also discarded the caller's message, which had not been committed yet. Transcripts lost lines. | The engine commits the user message before any tool runs. | `app/orchestration/engine.py` |
| 4 | Medium | A timed-out tool left partial, uncommitted writes in the session, and the audit commit in `finally` could then persist them. | Roll back on `TimeoutError`, as already done for other exceptions. | `app/tools/registry.py` |
| 5 | High | The dashboard opened the voice WebSocket with the user's long-lived login token in the URL, where proxies and access logs record it. Any JWT for the tenant was accepted. | New `POST /api/v1/agents/{id}/voice-ticket` issues a **1-minute ticket bound to one agent**. The WebSocket accepts only widget tokens and voice tickets, never login JWTs. Tickets are refused by the REST API. The frontend fetches a ticket for each call. | `app/api/voice.py`, `app/core/deps.py`, `frontend/src/services/api.ts`, `VoiceConsole.tsx` |
| 6 | Medium | Behind nginx every client shared the proxy's IP, and so one rate-limit bucket. The per-IP dict also grew without limit. | The limiter keeps only the current minute's counts. uvicorn runs with `--forwarded-allow-ips`. Compose binds backend port 8000 to `127.0.0.1`, so the real client IP comes through nginx. nginx sets `X-Forwarded-For` on the WebSocket route too. | `app/core/ratelimit.py`, `backend.Dockerfile`, `docker-compose.yml`, `nginx.conf` |
| 7 | Medium | A question containing a "yes" word ("can you **confirm** the time?", "is that **right**?") counted as the caller agreeing, which allowed a booking. | `caller_affirmed` rejects questions: a `?`, a leading question word, or Tamil, Tanglish or Hindi question words. | `app/tools/registry.py` |
| 8 | Medium | `PUT /agents/{id}` accepted any `voice_profile_id`, including another tenant's. | The tenant ownership check is shared with create (`_check_voice_profile`). | `app/api/agents.py` |
| 9 | Medium | Changing an agent's industry kept the previous industry's tools enabled. | An industry change with no new config creates a config version with the new industry's default tools. The engine also only exposes tools that the agent's industry offers. | `app/api/agents.py`, `app/orchestration/engine.py` |
| 10 | Low/Perf | Every turn loaded all of a tenant's knowledge chunks and rebuilt BM25 from scratch. | A per-scope BM25 index is cached in memory: up to 256 scopes, least-recently-used evicted. One aggregate query checks whether it is stale (chunk count, document count, latest document update). Ingest always bumps `updated_at`. | `app/knowledge/retrieval.py`, `app/knowledge/ingest.py` |

Updated tests:
- `test_customer_context_across_calls` now checks that no personal data leaks. It used to check that the data was returned.
- `test_voice_ticket_replaces_jwt_on_websocket` covers finding 5.

## Remaining limitations (by design, tracked in the roadmap)
- **Caller verification.** Being recognised by phone number is not verification. Cancelling or rescheduling still needs the phone number on the booking. Anything more sensitive needs OTP (roadmap, Phase 3).
- **Multi-instance deploys.** The rate limiter and the retrieval cache live in each process. Use Redis, or a gateway rate limit, when running more than one backend replica.
- **`FORWARDED_ALLOW_IPS="*"`** in compose is safe only because port 8000 is not published publicly. If you expose the backend directly, set it to your proxy's IP instead.
