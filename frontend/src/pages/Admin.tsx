import { useEffect, useState } from 'react'
import { Badge, Empty, ErrorNote, PageHeader, fmtDate } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { api } from '../services/api'
import type { Tenant } from '../types'

export function BusinessProfile() {
  const { data, error, setData } = useApi<Record<string, any>>('/business-profile')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hours, setHours] = useState('')
  useEffect(() => { if (data) setHours(JSON.stringify(data.operating_hours, null, 2)) }, [data])
  if (!data) return <ErrorNote error={error} />
  const field = (k: string, label: string) => (
    <div><label className="label">{label}</label><input className="input" value={data[k] ?? ''} onChange={(e) => setData({ ...data, [k]: e.target.value })} /></div>
  )
  const save = async () => {
    setMsg(null); setErr(null)
    try {
      const body = { ...data, operating_hours: JSON.parse(hours || '{}') }
      setData(await api('/business-profile', { method: 'PUT', json: body }))
      setMsg('Saved')
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
        <div className="md:col-span-2"><label className="label">Operating hours (JSON)</label><textarea className="input h-24 font-mono text-xs" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
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
  const { data: ind } = useApi<{ available: { key: string; label: string }[]; planned: { key: string; label: string }[] }>('/industries')
  const [f, setF] = useState({ name: '', slug: '', industry: 'custom', admin_email: '', admin_password: '' })
  const [err, setErr] = useState<string | null>(null)
  const create = async () => {
    setErr(null)
    try {
      await api('/tenants', { method: 'POST', json: { ...f, admin_email: f.admin_email || null, admin_password: f.admin_password || null } })
      setF({ name: '', slug: '', industry: 'custom', admin_email: '', admin_password: '' }); reload()
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
