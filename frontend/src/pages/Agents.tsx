import { useEffect, useState } from 'react'
import { Badge, ErrorNote, PageHeader } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { api } from '../services/api'
import { LANGUAGES, type Agent, type AgentConfig, type ToolInfo, type VoiceProfile } from '../types'

export default function Agents() {
  const { data: agents, reload } = useApi<Agent[]>('/agents')
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => { if (agents?.length && !selected) setSelected(agents[0].id) }, [agents, selected])
  return (
    <div>
      <PageHeader title="Agents" subtitle="Personality, instructions, voice, languages and tools per agent. Saving creates a new config version." />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-2">
          {agents?.map((a) => (
            <button key={a.id} onClick={() => setSelected(a.id)}
              className={`card w-full text-left ${selected === a.id ? 'ring-2 ring-brand-500' : ''}`}>
              <div className="font-medium">{a.name}</div>
              <div className="mt-1 flex gap-1"><Badge tone="blue">{a.industry.replace('_', ' ')}</Badge>{!a.is_active && <Badge tone="red">inactive</Badge>}</div>
            </button>
          ))}
        </div>
        {selected && <AgentEditor key={selected} id={selected} onSaved={reload} />}
      </div>
    </div>
  )
}

function AgentEditor({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { data: agent, error, setData } = useApi<Agent>(`/agents/${id}`)
  const { data: catalog } = useApi<ToolInfo[]>('/agents/tools/catalog')
  const { data: industries } = useApi<{ available: { key: string; default_tools: string[] }[] }>('/industries')
  const { data: voices } = useApi<{ suggested: Record<string, string[]> }>('/voice-profiles/voices')
  const [cfg, setCfg] = useState<AgentConfig | null>(null)
  const [vp, setVp] = useState<VoiceProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { if (agent?.config) setCfg(agent.config); if (agent?.voice_profile) setVp(agent.voice_profile) }, [agent])
  if (!agent || !cfg) return <ErrorNote error={error} />

  const allowed = industries?.available.find((i) => i.key === agent.industry)?.default_tools ?? []
  const tools = catalog?.filter((t) => allowed.includes(t.name)) ?? []

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const { config: _c, voice_profile: _v, id: _i, tenant_id: _t, created_at: _ca, ...rest } = agent
      const updated = await api<Agent>(`/agents/${id}`, { method: 'PUT', json: { ...rest, config: {
        persona_name: cfg.persona_name, personality: cfg.personality, system_instructions: cfg.system_instructions,
        greeting: cfg.greeting, enabled_tools: cfg.enabled_tools, workflows: cfg.workflows,
        escalation_policy: cfg.escalation_policy, llm_settings: cfg.llm_settings,
      } } })
      if (vp) await api(`/voice-profiles/${vp.id}`, { method: 'PUT', json: vp })
      setData(updated)
      setMsg(`Saved — configuration version ${updated.config?.version}`)
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setSaving(false) }
  }

  const toggleLang = (code: string) => {
    const langs = agent.languages.includes(code) ? agent.languages.filter((l) => l !== code) : [...agent.languages, code]
    setData({ ...agent, languages: langs })
  }

  return (
    <div className="space-y-4">
      <ErrorNote error={err} />
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}
      <div className="card grid gap-4 md:grid-cols-2">
        <div><label className="label">Agent name</label><input className="input" value={agent.name} onChange={(e) => setData({ ...agent, name: e.target.value })} /></div>
        <div><label className="label">Persona name (how the agent introduces itself)</label><input className="input" value={cfg.persona_name} onChange={(e) => setCfg({ ...cfg, persona_name: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">Personality</label><textarea className="input h-20" value={cfg.personality} onChange={(e) => setCfg({ ...cfg, personality: e.target.value })} /></div>
        <div className="md:col-span-2"><label className="label">Business-specific instructions (added to industry defaults)</label>
          <textarea className="input h-28 font-mono text-xs" placeholder="e.g. Always mention free pickup for site visits. Never quote prices for Phase 2 units." value={cfg.system_instructions} onChange={(e) => setCfg({ ...cfg, system_instructions: e.target.value })} /></div>
        <div>
          <label className="label">Languages</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <label key={code} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={agent.languages.includes(code)} onChange={() => toggleLang(code)} />{name}</label>
            ))}
          </div>
        </div>
        <div><label className="label">Default language</label>
          <select className="input" value={agent.default_language} onChange={(e) => setData({ ...agent, default_language: e.target.value })}>
            {agent.languages.map((l) => <option key={l} value={l}>{LANGUAGES[l] ?? l}</option>)}
          </select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agent.public_widget_enabled} onChange={(e) => setData({ ...agent, public_widget_enabled: e.target.checked })} />Allow public website widget</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agent.is_active} onChange={(e) => setData({ ...agent, is_active: e.target.checked })} />Active</label>
      </div>

      {vp && (
        <div className="card">
          <div className="mb-3 text-sm font-semibold">Voice (Sarvam {vp.tts_model})</div>
          <div className="grid gap-4 md:grid-cols-3">
            {agent.languages.map((l) => (
              <div key={l}><label className="label">{LANGUAGES[l] ?? l} speaker</label>
                <input className="input" list={`voices-${l}`} value={vp.speakers[l] ?? ''} placeholder="default"
                  onChange={(e) => setVp({ ...vp, speakers: { ...vp.speakers, [l]: e.target.value } })} />
                <datalist id={`voices-${l}`}>{voices?.suggested[l]?.map((v) => <option key={v} value={v} />)}</datalist>
              </div>
            ))}
            <div><label className="label">Pace ({vp.pace.toFixed(2)})</label><input type="range" min={0.7} max={1.3} step={0.05} className="w-full" value={vp.pace} onChange={(e) => setVp({ ...vp, pace: +e.target.value })} /></div>
            <div><label className="label">Expressiveness ({vp.temperature.toFixed(2)})</label><input type="range" min={0.1} max={1} step={0.05} className="w-full" value={vp.temperature} onChange={(e) => setVp({ ...vp, temperature: +e.target.value })} /></div>
          </div>
          <p className="mt-2 text-xs text-slate-400">Bulbul v4 personas are named &lt;name&gt;_&lt;lang&gt;_&lt;style&gt;. Sarvam has no Tamil “customer” style yet — audition the Tamil voices.</p>
        </div>
      )}

      <div className="card">
        <div className="mb-3 text-sm font-semibold">Greeting</div>
        <div className="grid gap-3 md:grid-cols-2">
          {agent.languages.map((l) => (
            <div key={l}><label className="label">{LANGUAGES[l] ?? l}</label>
              <input className="input" placeholder="Default greeting" value={cfg.greeting[l] ?? ''} onChange={(e) => setCfg({ ...cfg, greeting: { ...cfg.greeting, [l]: e.target.value } })} /></div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="mb-3 text-sm font-semibold">Tools</div>
        <div className="grid gap-2 md:grid-cols-2">
          {tools.map((t) => (
            <label key={t.name} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <input type="checkbox" className="mt-1" checked={cfg.enabled_tools.includes(t.name)}
                onChange={(e) => setCfg({ ...cfg, enabled_tools: e.target.checked ? [...cfg.enabled_tools, t.name] : cfg.enabled_tools.filter((n) => n !== t.name) })} />
              <span><span className="font-mono text-xs font-medium">{t.name}</span>{t.requires_confirmation && <Badge tone="amber">confirms</Badge>}
                <span className="block text-xs text-slate-500">{t.description}</span></span>
            </label>
          ))}
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
    </div>
  )
}
