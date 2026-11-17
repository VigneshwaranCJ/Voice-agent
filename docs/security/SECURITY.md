# Security model

## Secrets
- Every secret lives in `.env`, which is git-ignored, or in the deploy platform's secret store. None are in source code or the frontend bundle.
  - Secrets include `SARVAM_API_KEY`, `JWT_SECRET`, `ENCRYPTION_KEY` and database URLs.
- The Sarvam key is used **only by the backend**. The browser never sees it.
- Stored business-system credentials (Integrations) are encrypted with Fernet (`ENCRYPTION_KEY`). The API never returns them.
- If `ENCRYPTION_KEY` is missing outside `development`, the server refuses to store credentials.

## Authentication & roles
- Passwords are hashed with PBKDF2-SHA256. Sessions are HS256 JWTs signed with `JWT_SECRET`.
- The JWT carries `role` and `tid` (tenant id):
  - `platform_admin`: all tenants. It picks one with the `X-Tenant-ID` header.
  - `tenant_admin`: manages its own tenant.
  - `tenant_agent`: read access and the test console.
- A non-platform user who sends an `X-Tenant-ID` header for another tenant gets **403**.

### Voice WebSocket credentials
Browsers can't set headers on a WebSocket, so the credential goes in the query string, which access logs record. To keep that safe, the socket **never accepts login JWTs**. It accepts only these two, and both are bound to a single agent:

| Credential | Issued by | Lifetime | Usable for |
|---|---|---|---|
| Voice ticket (`kind=ws`) | `POST /api/v1/agents/{id}/voice-ticket` (authenticated, same tenant) | 1 min | That agent's WebSocket only |
| Widget token (`kind=widget`) | `POST /api/v1/public/agents/{id}/session` (agents with `public_widget_enabled`) | 15 min | That agent's WebSocket only |

The REST API rejects both kinds with 401.

## Tenant isolation
- Every business table has `tenant_id`. Every query filters by the tenant from the token, never from the request body.
- Tools get `tenant_id` and `agent_id` from the `ToolContext` built by the server. The LLM can't supply or override them.
- An agent can only call tools enabled for it **and** offered by its industry. Others return `denied`.
- Knowledge retrieval is scoped to the tenant, plus the agent or shared documents.
- `tests/test_tenant_isolation.py` covers the API, tools, retrieval and WebSocket isolation.

## Caller data & personal information
- **A phone number is identification, not verification.** `identify_customer` links the call to a customer record but returns no stored personal data: no name, appointments or enquiries. The prompt marks the caller as "NOT verified".
- Cancelling or rescheduling checks the phone number against the booking itself.
- Bookings, cancellations and reschedules need the **caller's** explicit yes:
  - The model can't confirm and execute in the same turn.
  - A question such as "can you confirm…?" doesn't count as a yes.
- Planned: OTP verification before sharing any stored record.

## Emergency handling (healthcare)
- A deterministic, word-bounded regex runs **before** the LLM (English, Tamil, Tanglish, Hindi).
- When it matches:
  - The caller is told to call 108.
  - A `critical` escalation is created.
  - No LLM call is made.

## Abuse controls
- Each client IP gets a fixed per-minute rate limit (`RATE_LIMIT_PER_MINUTE`).
  - Behind nginx the real IP comes from `X-Forwarded-For`, which uvicorn trusts via `--forwarded-allow-ips`.
  - Backend port 8000 is bound to localhost in compose.
  - For multi-replica deploys, use Redis or a gateway limiter.
- Tool calls have a timeout (`tool_timeout_seconds`), are validated with Pydantic, and are written to the audit table (`tool_executions`).
- Admin changes are written to `audit_logs`.

## Reporting
Report security problems privately to the maintainers. Don't open a public issue.
