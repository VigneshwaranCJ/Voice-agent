import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { Badge, Empty, ErrorNote, PageHeader, fmtDate } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../hooks/useAuth'
import { api } from '../services/api'
import type { Tenant } from '../types'

export function BusinessProfile() {
  const { data, error, setData } = useApi<Record<string, any>>('/business-profile')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toast = useToast()
  const [hours, setHours] = useState<[string, string][]>([])
  useEffect(() => { if (data) setHours(Object.entries(data.operating_hours ?? {}) as [string, string][]) }, [data])
  if (!data) return <ErrorNote error={error} />
  const field = (k: string, label: string) => (
    <div><label className="label">{label}</label><input className="input" value={data[k] ?? ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} /></div>
  )
  const save = async () => {
    setMsg(null); setErr(null)
    try {
      const operating_hours = Object.fromEntries(hours.map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k && v))
      setData(await api('/business-profile', { method: 'PUT', json: { ...data, operating_hours } }))
      setMsg('Saved')
      toast('Business profile saved')
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Settings" title="Business Profile" subtitle="Business context given to the agent on every call." />
      <ErrorNote error={err} />
      {msg && <div className="mb-4 text-sm text-emerald-700">{msg}</div>}
      <div className="card grid gap-4 md:grid-cols-2">
        {field('display_name', 'Display name')}{field('phone', 'Phone')}{field('email', 'Email')}{field('website', 'Website')}{field('timezone', 'Timezone')}
        <div className="md:col-span-2"><label className="label">Description</label><textarea className="input h-20" value={data.description} onChange={(e) => setData({ ...data, description: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">Services (comma separated)</label>
          <input className="input" value={(data.services ?? []).join(', ')} onChange={(e) => setData({ ...data, services: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></div>
        <div className="md:col-span-2"><HoursEditor rows={hours} onChange={setHours} /></div>
      </div>
      <button className="btn mt-4" onClick={save}>Save</button>
    </div>
  )
}

export function Integrations() {
  const { data, reload, error } = useApi<{ id: string; name: string; kind: string; permissions: string; last_tested_at: string | null; last_test_ok: boolean | null }[]>('/integrations/connections')
  const [form, setForm] = useState({ name: '', kind: 'postgresql', dsn: '', base_url: '', api_key: '', permissions: 'read' })
  const [result, setResult] = useState<Record<string, string>>({})
  const [err, setErr] = useState<string | null>(null)
  const create = async () => {
    setErr(null)
    const config = form.kind === 'rest_api' ? { base_url: form.base_url, api_key: form.api_key || undefined } : { dsn: form.dsn }
    try { await api('/integrations/connections', { method: 'POST', json: { name: form.name, kind: form.kind, permissions: form.permissions, config } }); setForm({ ...form, name: '', dsn: '', base_url: '', api_key: '' }); reload() }
    catch (e) { setErr((e as Error).message) }
  }
  const test = async (id: string) => {
    const r = await api<{ ok: boolean; message: string }>(`/integrations/connections/${id}/test`, { method: 'POST' })
    setResult({ ...result, [id]: `${r.ok ? '✓' : '✗'} ${r.message}` }); reload()
  }
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Connections" title="Integrations" subtitle="Connect the business's own database or API. Credentials are encrypted at rest and never shown again." />
      <ErrorNote error={err || error} />
      <div className="card mb-6 grid gap-3 md:grid-cols-2">
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Type</label><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="rest_api">REST API</option></select></div>
        {form.kind === 'rest_api' ? (<>
          <div><label className="label">Base URL</label><input className="input" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></div>
          <div><label className="label">API key (optional)</label><input className="input" type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} /></div>
        </>) : (
          <div className="md:col-span-2"><label className="label">Connection string</label><input className="input font-mono text-xs" type="password" placeholder={form.kind === 'mysql' ? 'host/user/password via API' : 'postgresql://user:pass@host:5432/db'} value={form.dsn} onChange={(e) => setForm({ ...form, dsn: e.target.value })} /></div>
        )}
        <div><label className="label">Permissions</label><select className="input" value={form.permissions} onChange={(e) => setForm({ ...form, permissions: e.target.value })}><option value="read">Read only</option><option value="read_write">Read / write</option></select></div>
        <div className="flex items-end"><button className="btn" disabled={!form.name} onClick={create}>Add connection</button></div>
      </div>
      <div className="card">
        {data?.length ? (
          <table className="table"><thead><tr><th>Name</th><th>Type</th><th>Access</th><th>Last test</th><th></th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}><td className="font-medium">{c.name}</td><td>{c.kind}</td><td>{c.permissions}</td>
                <td>{c.last_test_ok == null ? '—' : <Badge tone={c.last_test_ok ? 'green' : 'red'}>{c.last_test_ok ? 'ok' : 'failed'}</Badge>} <span className="text-xs text-slate-400">{fmtDate(c.last_tested_at)}</span>
                  {result[c.id] && <div className="text-xs text-slate-500">{result[c.id]}</div>}</td>
                <td className="text-right"><button className="btn-ghost" onClick={() => test(c.id)}>Test</button></td></tr>
            ))}</tbody></table>
        ) : <Empty>No external connections. Demo businesses use the platform's built-in tables.</Empty>}
      </div>
    </div>
  )
}

export function Tenants() {
  const { data, reload, error } = useApi<Tenant[]>('/tenants')
  const { refreshTenants } = useAuth()
  const { data: ind } = useApi<{ available: { key: string; label: string }[]; planned: { key: string; label: string }[] }>('/industries')
  const [f, setF] = useState({ name: '', slug: '', industry: 'custom', admin_email: '', admin_password: '' })
  const [err, setErr] = useState<string | null>(null)
  const create = async () => {
    setErr(null)
    try {
      await api('/tenants', { method: 'POST', json: { ...f, admin_email: f.admin_email || null, admin_password: f.admin_password || null } })
      setF({ name: '', slug: '', industry: 'custom', admin_email: '', admin_password: '' }); reload()
      await refreshTenants() // the account menu's business switcher picks it up (and selects it if none was)
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Platform" title="All Businesses" subtitle="Onboard a business without code changes. Then create its agent under Agents." />
      <ErrorNote error={err || error} />
      <div className="card mb-6 grid gap-3 md:grid-cols-2">
        <div><label className="label">Business name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></div>
        <div><label className="label">Slug</label><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></div>
        <div><label className="label">Industry</label><select className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>
          {ind?.available.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          {ind?.planned.map((i) => <option key={i.key} value={i.key}>{i.label} (uses custom module for now)</option>)}</select></div>
        <div />
        <div><label className="label">Admin email (optional)</label><input className="input" value={f.admin_email} onChange={(e) => setF({ ...f, admin_email: e.target.value })} /></div>
        <div><label className="label">Admin password (min 8)</label><input className="input" type="password" value={f.admin_password} onChange={(e) => setF({ ...f, admin_password: e.target.value })} /></div>
        <div><button className="btn" disabled={!f.name || !f.slug} onClick={create}>Create business</button></div>
      </div>
      <div className="card">{data?.length ? (
        <table className="table"><thead><tr><th>Name</th><th>Industry</th><th>Slug</th><th>Created</th></tr></thead>
          <tbody>{data.map((t) => <tr key={t.id}><td className="font-medium">{t.name}</td><td>{t.industry}</td><td className="font-mono text-xs">{t.slug}</td><td>{fmtDate(t.created_at)}</td></tr>)}</tbody></table>
      ) : <Empty>No businesses.</Empty>}</div>
    </div>
  )
}

const HOURS_PRESETS: Record<string, [string, string][]> = {
  'Mon–Sat, Sunday closed': [['Mon-Sat', '9:30 AM - 6:30 PM'], ['Sunday', 'Closed']],
  'Mon–Fri, weekends closed': [['Mon-Fri', '9:00 AM - 6:00 PM'], ['Sat-Sun', 'Closed']],
  'Open every day': [['Mon-Sun', '9:00 AM - 9:00 PM']],
  'Hospital (OPD + 24×7 emergency)': [['OPD Mon-Sat', '9:00 AM - 6:00 PM'], ['Emergency', '24 x 7']],
}

/** Opening hours as label → hours rows (stored as a JSON object the agent reads on every call). */
function HoursEditor({ rows, onChange }: { rows: [string, string][]; onChange: (r: [string, string][]) => void }) {
  const set = (i: number, j: 0 | 1, v: string) => onChange(rows.map((r, k) => (k === i ? (j ? [r[0], v] : [v, r[1]]) : r)))
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">Opening hours</span>
        <select aria-label="Fill from a preset" className="input w-auto py-1 text-xs" value=""
          onChange={(e) => e.target.value && onChange(HOURS_PRESETS[e.target.value])}>
          <option value="">Fill from a preset…</option>
          {Object.keys(HOURS_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {rows.map(([day, time], i) => (
          <div key={i} className="flex gap-2">
            <input aria-label="Days" className="input w-44" placeholder="e.g. Mon-Sat" value={day} onChange={(e) => set(i, 0, e.target.value)} />
            <input aria-label="Hours" className="input" placeholder="e.g. 9:30 AM - 6:30 PM, or Closed" value={time} onChange={(e) => set(i, 1, e.target.value)} />
            <button type="button" className="btn-ghost" aria-label={`Remove ${day || 'row'}`} onClick={() => onChange(rows.filter((_, k) => k !== i))}>Remove</button>
          </div>
        ))}
        {!rows.length && <p className="text-xs text-slate-400">No hours set. The agent will say it doesn't know your timings.</p>}
        <button type="button" className="btn-ghost" onClick={() => onChange([...rows, ['', '']])}>+ Add row</button>
      </div>
    </div>
  )
}
