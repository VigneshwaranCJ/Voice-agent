import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ChangePasswordDialog from '../components/ChangePasswordDialog'
import { useAuth } from '../hooks/useAuth'

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/voice', label: 'Voice' },
  { to: '/agents', label: 'Agents' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/calls', label: 'Calls' },
  { to: '/data', label: 'Data' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/business', label: 'Business' },
]

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <rect x="3" y="9" width="2.6" height="6" rx="1.3" fill="currentColor" />
      <rect x="7.6" y="5" width="2.6" height="14" rx="1.3" fill="currentColor" />
      <rect x="12.2" y="7.5" width="2.6" height="9" rx="1.3" fill="currentColor" />
      <rect x="16.8" y="3.5" width="2.6" height="17" rx="1.3" fill="currentColor" />
    </svg>
  )
}

function PickBusiness({ hasAny, onOpenMenu }: { hasAny: boolean; onOpenMenu: () => void }) {
  return (
    <div className="card mx-auto max-w-xl py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {hasAny ? 'Choose a business' : 'Create your first business'}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
        {hasAny
          ? 'Agents, calls, knowledge and data belong to a business. Pick one from the account menu to manage it.'
          : 'Agents, calls, knowledge and data belong to a business. Add one to get started, then create its voice agent under Agents.'}
      </p>
      <div className="mt-6">
        {hasAny
          ? <button className="btn" onClick={onOpenMenu}>Choose business</button>
          : <NavLink to="/tenants" className="btn">Create a business</NavLink>}
      </div>
    </div>
  )
}

export default function AppLayout() {
  const { user, tenants, tenantId, setTenantId, logout } = useAuth()
  const isPlatform = user?.role === 'platform_admin'
  const [menu, setMenu] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const closePasswordDialog = useCallback(() => setChangingPassword(false), [])
  const menuRef = useRef<HTMLDivElement>(null)
  const loc = useLocation()

  useEffect(() => { setMenu(false) }, [loc.pathname])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])

  // Every page except Businesses works on one business; a platform admin must have one selected first.
  const needsBusiness = isPlatform && !tenantId && loc.pathname !== '/tenants'
  const nav = [...NAV, ...(isPlatform ? [{ to: '/tenants', label: 'Businesses', end: false }] : [])]
  const initials = (user?.email ?? '?').slice(0, 1).toUpperCase()

  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-30 border-b border-black/[0.06] shadow-[0_1px_0_rgb(255_255_255/0.6)_inset]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <NavLink to="/" className="flex items-center gap-2 text-slate-900" aria-label="VoiceCare home">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-[#8e5cf7] text-white shadow-[0_4px_12px_-4px_rgb(0_113_227/0.6)]"><Logo /></span>
            <span className="text-[15px] font-semibold tracking-tight">VoiceCare</span>
          </NavLink>
          <nav className="-mx-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition-colors duration-300 ${isActive ? 'bg-slate-900/[0.06] font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] text-slate-700 transition hover:bg-slate-900/[0.05]">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-xs font-semibold text-white">{initials}</span>
              <span className="hidden max-w-40 truncate sm:block">{isPlatform ? tenants.find((t) => t.id === tenantId)?.name ?? 'Platform' : user?.tenant_name}</span>
            </button>
            {menu && (
              <div role="menu" className="glass animate-rise absolute right-0 mt-2 w-72 rounded-2xl p-2 shadow-[var(--shadow-float)] ring-1 ring-black/5" style={{ animationDuration: '0.35s' }}>
                <div className="px-3 py-2">
                  <div className="truncate text-sm font-medium text-slate-900">{user?.email}</div>
                  <div className="text-xs capitalize text-slate-500">{user?.role.replace('_', ' ')}</div>
                </div>
                {isPlatform && (
                  <div className="px-3 pb-2">
                    <label className="label" htmlFor="tenant-switch">Business</label>
                    <select id="tenant-switch" className="input" value={tenantId ?? ''} onChange={(e) => setTenantId(e.target.value)}>
                      {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="my-1 h-px bg-black/5" />
                <button role="menuitem" onClick={() => { setMenu(false); setChangingPassword(true) }}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-900/[0.05]">Change password</button>
                <button role="menuitem" onClick={logout} className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-900/[0.05]">Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-12">
        <div key={`${tenantId ?? 'none'}:${loc.pathname}`} className="animate-fade">
          {needsBusiness ? <PickBusiness hasAny={tenants.length > 0} onOpenMenu={() => setMenu(true)} /> : <Outlet key={tenantId ?? 'none'} />}
        </div>
      </main>
      {changingPassword && <ChangePasswordDialog onClose={closePasswordDialog} />}
    </div>
  )
}
