import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, session } from '../services/api'
import type { Tenant, User } from '../types'

interface AuthCtx {
  user: User | null
  loading: boolean
  tenants: Tenant[]
  tenantId: string | null
  setTenantId: (id: string) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantId, setTid] = useState<string | null>(session.tenantId)

  const loadTenants = useCallback(async (u: User) => {
    const list = await api<Tenant[]>('/tenants')
    setTenants(list)
    const current = u.role === 'platform_admin' ? session.tenantId : u.tenant_id
    const chosen = current && list.some((t) => t.id === current) ? current : list[0]?.id ?? null
    session.tenantId = u.role === 'platform_admin' ? chosen : null
    setTid(chosen)
  }, [])

  useEffect(() => {
    if (!session.token) { setLoading(false); return }
    api<User>('/auth/me')
      .then(async (u) => { setUser(u); await loadTenants(u) })
      .catch(() => { session.token = null })
      .finally(() => setLoading(false))
  }, [loadTenants])

  const login = async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>('/auth/login', { method: 'POST', json: { email, password } })
    session.token = res.access_token
    setUser(res.user)
    await loadTenants(res.user)
  }

  const logout = () => {
    session.token = null
    session.tenantId = null
    setUser(null)
    window.location.href = '/login'
  }

  const setTenantId = (id: string) => {
    if (user?.role === 'platform_admin') session.tenantId = id
    setTid(id)
  }

  return <Ctx.Provider value={{ user, loading, tenants, tenantId, setTenantId, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}
