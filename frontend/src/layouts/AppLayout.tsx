import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/voice', label: 'Voice Console' },
  { to: '/agents', label: 'Agents' },
  { to: '/knowledge', label: 'Knowledge Base' },
  { to: '/calls', label: 'Calls & Transcripts' },
  { to: '/data', label: 'Business Data' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/business', label: 'Business Profile' },
]

export default function AppLayout() {
  const { user, tenants, tenantId, setTenantId, logout } = useAuth()
  const isPlatform = user?.role === 'platform_admin'
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-sm font-semibold text-brand-700">VoiceCare Platform</div>
          <div className="text-xs text-slate-400">Multi-industry AI customer care</div>
        </div>
        <div className="border-b border-slate-200 px-4 py-3">
          <label className="label">Business</label>
          {isPlatform ? (
            <select className="input" value={tenantId ?? ''} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          ) : (
            <div className="text-sm font-medium">{user?.tenant_name}</div>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              {n.label}
            </NavLink>
          ))}
          {isPlatform && (
            <NavLink to="/tenants" className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              All Businesses
            </NavLink>
          )}
        </nav>
        <div className="border-t border-slate-200 p-4 text-xs text-slate-500">
          <div className="truncate font-medium text-slate-700">{user?.email}</div>
          <div className="mb-2">{user?.role.replace('_', ' ')}</div>
          <button className="btn-ghost w-full justify-center" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <Outlet key={tenantId ?? 'none'} />
      </main>
    </div>
  )
}
