# API reference

The base path is `/api/v1`. All endpoints except `auth/login`, `public/*` and `/health` need a token:

```
Authorization: Bearer <jwt>
```

A platform admin picks a tenant by adding:

```
X-Tenant-ID: <tenant_id>
```

Interactive docs are at `/docs` (FastAPI OpenAPI).

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{access_token, user}` |
| GET | `/auth/me` | Current user |
| POST | `/auth/change-password` | `{current_password, new_password}` (12+ chars). Own account only. |

## Team (`/users`)
Scope comes from the principal: the selected business's users, or platform admins when none is selected.
| Method | Path | Notes |
|---|---|---|
| GET | `/users` | Anyone in the scope (to pick assignees) |
| POST | `/users` | Admins. `{email, full_name, role, password}`; business roles `tenant_admin` / `tenant_agent` |
| PATCH | `/users/{id}` | Admins. `{full_name?, role?, is_active?}`. Deactivation locks the user out immediately. |
| POST | `/users/{id}/reset-password` | Admins, for someone else. `{new_password}` |

## Email alerts
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications/email` | Admins. `{configured, recipients}` (the business's active admins) |
| POST | `/notifications/email/test` | Admins. Sends a test to yourself; 503 when SMTP isn't configured |

## Tenants & business
| Method | Path | Role |
|---|---|---|
| GET | `/industries` | any |
| GET / POST | `/tenants` | GET: any. POST: platform admin. |
| GET / PUT | `/business-profile` | PUT: tenant admin |
| GET / POST | `/voice-profiles` | POST: tenant admin |
| PUT | `/voice-profiles/{id}` | tenant admin |
| GET | `/voice-profiles/voices` | Available Sarvam speakers |

## Agents
| Method | Path | Notes |
|---|---|---|
| GET | `/agents/tools/catalog` | All tools, with their JSON schemas |
| GET / POST | `/agents` | Tools are checked against the agent's industry. The voice profile must belong to your tenant. |
| GET / PUT | `/agents/{id}` | Changing `industry` without sending `config` resets tools to that industry's defaults. |
| PUT | `/agents/{id}/config` | Creates a new config version |
| GET | `/agents/{id}/config/history` | Earlier config versions |
| POST | `/agents/{id}/chat` | Text test console. Body: `{text, conversation_id?, language?}`. Returns 503 if no Sarvam key is set. |
| POST | `/agents/{id}/voice-ticket` | Returns `{ticket}`, valid 1 min for this agent's WebSocket |
| POST | `/conversations/{id}/end` | Ends a text-console conversation |

## Knowledge
| Method | Path | Notes |
|---|---|---|
| GET | `/knowledge/documents` | |
| POST | `/knowledge/documents/upload` | Multipart upload: PDF, DOCX, TXT, MD or CSV, up to 16 MB |
| POST | `/knowledge/documents/text` | Add an FAQ or policy as plain text |
| POST | `/knowledge/documents/{id}/reindex` | |
| DELETE | `/knowledge/documents/{id}` | |
| GET | `/knowledge/search?q=` | Test retrieval |

## Business data
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/data/properties` | |
| PUT | `/data/properties/{id}` | |
| GET | `/data/sales-executives` | |
| GET | `/data/departments` | |
| GET / POST | `/data/doctors` | |
| POST | `/data/doctors/{id}/slots/generate` | |

## Integrations
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/integrations/connections` | Credentials are encrypted and never returned |
| POST | `/integrations/connections/{id}/test` | Opens a real connection: PostgreSQL, MySQL or REST |
| DELETE | `/integrations/connections/{id}` | |

## Calls & analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/conversations` | Filters: `status`, `channel`, `language`, `agent_id`, `date_from`, `date_to`, `q` (searches summaries and transcripts); `limit` ≤ 500, `offset` |
| GET | `/conversations/{id}` | Transcript, tool history and escalations |
| GET | `/escalations`, `/leads`, `/appointments` | Leads and escalations include `assigned_to` and `notes` |
| PATCH | `/leads/{id}` | `{status?, assigned_to?, notes?}`; `assigned_to: null` unassigns |
| PATCH | `/escalations/{id}` | `{status?, assigned_to?, notes?}`; assigning an open escalation marks it `assigned` |
| GET | `/analytics/overview` | KPIs; `daily` and `hours` are in the business's timezone; `leads`, `escalations` by status |

## Public widget
| Method | Path | Notes |
|---|---|---|
| POST | `/public/agents/{id}/session` | Returns a 15-min widget token plus the agent's greeting. Only for agents with `public_widget_enabled`. |
| POST | `/public/chat` | `Authorization: Bearer <widget token>`, `{text, conversation_id?}`. Plain HTTP, any origin (no cookies). |
| POST | `/public/chat/{conversation_id}/end` | Ends the widget chat (it is then summarised) |

Embed: `<script src="https://YOUR-DASHBOARD/widget.js" data-agent="AGENT_ID" async></script>` (optional `data-color`, `data-title`, `data-position="left"`). Preview: `/widget-demo.html?agent=AGENT_ID`.

## Voice WebSocket — `/api/v1/voice/ws?agent_id=…&token=…`

`token` must be a **voice ticket** or a **widget token**. Login JWTs are rejected, and the server sends an `error` message and then closes with code 4401.

**Client → server messages**

| `type` | Payload |
|---|---|
| `audio` | `{audio: base64 PCM16 mono 16 kHz}` |
| `text` | `{text}`: a typed turn, no STT |
| `playback_done` | `{utterance_id}`: the client finished playing that reply |
| `stop` | Ends the call |

**Server → client messages**

| `type` | Meaning |
|---|---|
| `ready` | Session started: conversation id, language |
| `state` | `listening`, `thinking` or `speaking` |
| `transcript` | Caller speech, partial or final, with the detected language |
| `agent_text` | The agent's reply text, with its `utterance_id` |
| `audio` / `audio_end` | MP3 chunks for an utterance, then the end-of-utterance marker |
| `interrupt` | Barge-in: stop playback now |
| `error` | Account, quota or session error |
| `ended` | Call over, with a reason |
