import { Link, useParams } from 'react-router-dom'
import { Badge, Empty, ErrorNote, PageHeader, fmtDate, statusTone } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { LANGUAGES, type Conversation, type Message } from '../types'

export function Calls() {
  const { data, error } = useApi<Conversation[]>('/conversations?limit=100')
  const { data: escalations } = useApi<{ id: string; conversation_id: string; reason: string; priority: string; summary: string; status: string; at: string }[]>('/escalations?status=open')
  return (
    <div>
      <PageHeader title="Calls & Transcripts" />
      <ErrorNote error={error} />
      {!!escalations?.length && (
        <div className="card mb-6">
          <div className="mb-2 text-sm font-semibold text-rose-700">Open escalations</div>
          {escalations.map((e) => (
            <Link key={e.id} to={`/calls/${e.conversation_id}`} className="block border-b border-slate-100 py-2 text-sm last:border-0 hover:bg-slate-50">
              <Badge tone={e.priority === 'critical' ? 'red' : 'amber'}>{e.priority}</Badge> <span className="font-medium">{e.reason.replace('_', ' ')}</span>
              <span className="ml-2 text-slate-500">{e.summary.slice(0, 120)}</span>
              <span className="float-right text-xs text-slate-400">{fmtDate(e.at)}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="card overflow-x-auto">
        {data?.length ? (
          <table className="table">
            <thead><tr><th>Started</th><th>Channel</th><th>Status</th><th>Languages</th><th>Intents</th><th>Summary</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap"><Link className="text-brand-600 hover:underline" to={`/calls/${c.id}`}>{fmtDate(c.created_at)}</Link></td>
                <td>{c.channel.replace('_', ' ')}</td>
                <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                <td>{c.languages_used.map((l) => LANGUAGES[l] ?? l).join(', ')}</td>
                <td className="text-xs">{c.intents.join(', ')}</td>
                <td className="max-w-md text-xs text-slate-600">{c.summary ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No conversations yet.</Empty>}
      </div>
    </div>
  )
}

interface Detail {
  conversation: Conversation
  messages: Message[]
  tool_executions: { tool: string; status: string; arguments: unknown; result: unknown; error: string | null; duration_ms: number; at: string }[]
  escalations: { id: string; reason: string; priority: string; summary: string; status: string; at: string }[]
  call: { duration_seconds: number | null; status: string; end_reason: string | null } | null
  call_events: { type: string; payload: unknown; at: string }[]
}

export function CallDetail() {
  const { id } = useParams()
  const { data, error } = useApi<Detail>(`/conversations/${id}`)
  if (!data) return <ErrorNote error={error} />
  const c = data.conversation
  return (
    <div>
      <PageHeader title="Conversation" subtitle={`${fmtDate(c.created_at)} · ${c.channel.replace('_', ' ')}`}
        actions={<Link to="/calls" className="btn-ghost">← All calls</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="card space-y-3">
          {data.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}>
                {m.content}
                <div className="mt-1 text-[10px] opacity-70">{m.language && (LANGUAGES[m.language] ?? m.language)} {m.interrupted && '· interrupted'}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="card text-sm">
            <div className="mb-2 font-semibold">Summary</div>
            <p className="text-slate-600">{c.summary ?? 'Not available (call in progress or summary failed).'}</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge tone={statusTone(c.status)}>{c.status}</Badge>
              {data.call?.duration_seconds != null && <Badge>{Math.round(data.call.duration_seconds)}s</Badge>}
              {data.call?.end_reason && <Badge>{data.call.end_reason}</Badge>}</div>
          </div>
          {!!data.escalations.length && (
            <div className="card text-sm"><div className="mb-2 font-semibold text-rose-700">Escalations</div>
              {data.escalations.map((e) => <div key={e.id} className="mb-2"><Badge tone="red">{e.priority}</Badge> {e.reason} — <span className="text-slate-500">{e.summary}</span></div>)}
            </div>
          )}
          <div className="card text-sm">
            <div className="mb-2 font-semibold">Tool executions</div>
            {data.tool_executions.length ? data.tool_executions.map((t, i) => (
              <details key={i} className="mb-2 rounded border border-slate-100 p-2">
                <summary className="cursor-pointer"><span className="font-mono text-xs">{t.tool}</span> <Badge tone={t.status === 'success' ? 'green' : 'amber'}>{t.status}</Badge> <span className="text-xs text-slate-400">{t.duration_ms}ms</span></summary>
                <pre className="mt-2 overflow-x-auto text-[11px] text-slate-600">{JSON.stringify({ arguments: t.arguments, result: t.result, error: t.error }, null, 2)}</pre>
              </details>
            )) : <div className="text-slate-400">None</div>}
          </div>
          {!!data.call_events.length && (
            <div className="card text-sm"><div className="mb-2 font-semibold">Call events</div>
              {data.call_events.map((e, i) => <div key={i} className="text-xs"><span className="font-mono">{e.type}</span> <span className="text-slate-400">{fmtDate(e.at)}</span></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
