# Setup

## 1. Local development (SQLite, no Docker)

**Prerequisites**
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node 20+
- A Sarvam API key from <https://dashboard.sarvam.ai>

**Steps**

1. Create your env file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and set `SARVAM_API_KEY=...`. Leave the other values as they are for local development.
3. Start the backend:
   ```bash
   cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
   ```
4. In another terminal, start the frontend:
   ```bash
   cd frontend && npm install && npm run dev
   ```
5. Open <http://localhost:5173> and sign in with one of these demo accounts:

   | Account | Email | Password |
   |---|---|---|
   | Platform admin | `admin@platform.local` | `SEED_ADMIN_PASSWORD` |
   | Sunrise Realty | `admin@sunrise.local` | `SEED_TENANT_PASSWORD` |
   | CareWell Hospital | `admin@carewell.local` | `SEED_TENANT_PASSWORD` |

   The passwords are the values set in your `.env`.

The backend reads `.env` from either the repo root or `backend/`. On first start it creates the SQLite database and seeds the two fictional businesses, as long as `SEED_DEMO_DATA=true`.

**Windows notes**
- Install the `tzdata` package. It is already a dependency.
- If a console print of Tamil text fails, set `PYTHONIOENCODING=utf-8`.

## 2. Docker (PostgreSQL + Redis + nginx)

```bash
docker compose up --build
```

- **Dashboard and API** are at <http://localhost:8080>. nginx proxies `/api` and the voice WebSocket.
- **The backend** is reachable only from this machine, at `127.0.0.1:8000`, by design. The rate limiter can only see real client IPs when requests come through nginx (see `docs/security/SECURITY.md`).
- **Migrations:** the backend runs `alembic upgrade head` on start.

## 3. Production checklist
- [ ] Set `ENVIRONMENT=production`.
- [ ] Set a random `JWT_SECRET` of 48+ bytes.
- [ ] Set a Fernet `ENCRYPTION_KEY`. `.env.example` has the commands to generate both values.
- [ ] Set `SEED_DEMO_DATA=false` and remove the demo passwords.
- [ ] Set `CORS_ORIGINS` to your dashboard origin only.
- [ ] Serve over HTTPS. Browsers require a secure context for the microphone, except on `localhost`.
- [ ] Set `FORWARDED_ALLOW_IPS` to your proxy's IP if the backend is reachable by anything other than that proxy.
- [ ] Run more than one replica only with `REDIS_URL` set. Rate limiting and the retrieval cache live in each process, so also add a gateway rate limit.
- [ ] Back up PostgreSQL, and decide how long you keep transcripts.

## 4. Running tests
```bash
cd backend && uv run pytest -q
```
See `docs/testing/TESTING.md`. The tests use a scripted LLM and need no Sarvam key.
