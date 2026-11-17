# VoiceCare — Multi-Industry AI Customer Care Voice Platform (Sarvam AI)

One shared voice-agent engine; each business (tenant) gets its own data, knowledge base, agent personality,
voice, languages, tools and escalation rules. MVP ships two fictional demo businesses: **Sunrise Realty**
(real estate, Coimbatore/Chennai) and **CareWell Multispeciality Hospital** (Chennai), in English + Tamil.

- Architecture: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- Roadmap / status: [docs/ROADMAP.md](docs/ROADMAP.md)
- Testing: [docs/testing/TESTING.md](docs/testing/TESTING.md)
- Setup & production checklist: [docs/setup/SETUP.md](docs/setup/SETUP.md)
- API + voice WebSocket protocol: [docs/api/API.md](docs/api/API.md)
- Security model: [docs/security/SECURITY.md](docs/security/SECURITY.md)
- Review fixes log: [docs/REVIEW_FIXES.md](docs/REVIEW_FIXES.md)

## Quick start (local, no Docker)

Prereqs: Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 20+.

```bash
cp .env.example .env
```

Put your key from https://dashboard.sarvam.ai in `.env` as `SARVAM_API_KEY=...` (without it the dashboard works
but speech and AI replies are disabled; deterministic guardrails such as emergency escalation still respond).

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 and sign in with a seed account from `.env.example`. Go to **Voice Console**, pick an
agent, click **Start voice call**, and talk in English or Tamil. Interrupt the agent any time.

## Docker (PostgreSQL + Redis)

```bash
docker compose up --build
```

Dashboard and API on http://localhost:8080 (nginx). The backend's own port 8000 is bound to localhost only. The backend runs `alembic upgrade head` on start.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SARVAM_API_KEY` | yes (for voice/AI) | Sarvam STT, TTS and LLM |
| `SARVAM_STT_MODEL` / `SARVAM_TTS_MODEL` / `SARVAM_LLM_MODEL` | no | default `saaras:v4` / `bulbul:v4-flash` / `sarvam-105b-conversations` |
| `DATABASE_URL` | no | SQLite by default; `postgresql+asyncpg://…` for Postgres |
| `REDIS_URL` | no | live conversation state (in-process if unset) |
| `JWT_SECRET`, `ENCRYPTION_KEY` | yes outside dev | token signing; Fernet key for stored integration credentials |
| `SEED_*` | dev only | demo accounts |

## What works today
- Multi-tenant API with JWT/RBAC, audit log, tenant-isolated data, tools and knowledge retrieval
- Real-time browser voice: Sarvam realtime STT → agent engine (tool calling) → Sarvam streaming TTS, with barge-in,
  silence handling, language switching (Tamil ⇄ English) and per-language Bulbul v4 voices
- Real estate + hospital tools against real database tables; bookings need explicit confirmation
- Emergency/human-request guardrails, escalation records with context, call summaries, transcripts, tool history
- Admin dashboard for businesses, agents (versioned config), voice, knowledge base, integrations, calls, analytics

Not yet: phone channel, pgvector embeddings, OTP caller verification, hotel module.
See the roadmap.
