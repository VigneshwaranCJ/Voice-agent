import { ErrorNote, PageHeader, Stat } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { LANGUAGES } from '../types'

interface Overview {
  total_conversations: number; total_calls: number; answered_calls: number; missed_calls: number
  avg_call_duration_seconds: number; resolved: number; resolution_rate: number | null; escalated: number
  languages: Record<string, number>; channels: Record<string, number>; customer_satisfaction: number | null
  top_tools: { tool: string; count: number }[]; daily: { date: string; count: number }[]
}

function Bars({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1
  const entries = Object.entries(data)
  if (!entries.length) return <div className="text-sm text-slate-400">No data yet</div>
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="flex justify-between text-xs"><span>{LANGUAGES[k] ?? k}</span><span className="text-slate-500">{v}</span></div>
          <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${(v / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data, error } = useApi<Overview>('/analytics/overview?days=30')
  const max = Math.max(1, ...(data?.daily.map((d) => d.count) ?? [1]))
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Last 30 days" />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total calls" value={data.total_calls} hint={`${data.total_conversations} conversations incl. text`} />
            <Stat label="Answered / missed" value={`${data.answered_calls} / ${data.missed_calls}`} />
            <Stat label="Avg call duration" value={`${Math.round(data.avg_call_duration_seconds)}s`} />
            <Stat label="Resolution rate" value={data.resolution_rate == null ? '—' : `${Math.round(data.resolution_rate * 100)}%`} hint={`${data.resolved} resolved`} />
            <Stat label="Escalated" value={data.escalated} />
            <Stat label="Customer satisfaction" value={data.customer_satisfaction ?? '—'} hint="Post-call rating (Phase 5)" />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="mb-3 text-sm font-semibold">Conversations per day</div>
              {data.daily.length ? (
                <div className="flex h-40 items-end gap-1">
                  {data.daily.map((d) => (
                    <div key={d.date} className="flex-1 rounded-t bg-brand-500" style={{ height: `${(d.count / max) * 100}%` }} title={`${d.date}: ${d.count}`} />
                  ))}
                </div>
              ) : <div className="text-sm text-slate-400">No calls yet — try the Voice Console.</div>}
            </div>
            <div className="card"><div className="mb-3 text-sm font-semibold">Languages</div><Bars data={data.languages} /></div>
            <div className="card"><div className="mb-3 text-sm font-semibold">Channels</div><Bars data={data.channels} /></div>
            <div className="card lg:col-span-2">
              <div className="mb-3 text-sm font-semibold">Most used tools (intents)</div>
              <Bars data={Object.fromEntries(data.top_tools.map((t) => [t.tool, t.count]))} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
