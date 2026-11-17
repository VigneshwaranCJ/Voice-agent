const TOKEN_KEY = 'vc_token'
const TENANT_KEY = 'vc_tenant'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY) },
  set token(v: string | null) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY) },
  get tenantId() { return localStorage.getItem(TENANT_KEY) },
  set tenantId(v: string | null) { v ? localStorage.setItem(TENANT_KEY, v) : localStorage.removeItem(TENANT_KEY) },
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (session.token) headers.set('Authorization', `Bearer ${session.token}`)
  if (session.tenantId) headers.set('X-Tenant-ID', session.tenantId)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body })
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    session.token = null
    window.location.href = '/login'
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Short-lived (1 min), agent-bound ticket. The login JWT is never put in a WebSocket URL. */
export async function voiceTicket(agentId: string): Promise<string> {
  const res = await api<{ ticket: string }>(`/agents/${encodeURIComponent(agentId)}/voice-ticket`, { method: 'POST' })
  return res.ticket
}

export function voiceSocketUrl(agentId: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/v1/voice/ws?agent_id=${encodeURIComponent(agentId)}&token=${encodeURIComponent(token)}`
}
