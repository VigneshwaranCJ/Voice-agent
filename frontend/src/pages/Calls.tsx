import { Link, useParams } from 'react-router-dom'
import { Badge, Empty, ErrorNote, Icons, PageHeader, fmtDate, statusTone } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { LANGUAGES, type Conversation, type Message } from '../types'

export function Calls() {
  const { data, error } = useApi<Conversation[]>('/conversations?limit=100')
  const { data: escalations } = useApi<{ id: string; conversation_id: string; reason: string; priority: string; summary: string; status: string; at: string }[]>('/escalations?status=open')
  return (
    <div>
      <PageHeader eyebrow="Activity" title="Calls & Transcripts" subtitle="Every conversation, with what the agent did and why." />
      <ErrorNote error={error} />
      {!!escalations?.length && (
        <div className="card mb-6 overflow-hidden bg-gradient-to-br from-rose-50/70 to-white p-0">
          <div className="flex items-center gap-3 px-6 pb-2 pt-5">
            <span className="icon-tile h-8 w-8 rounded-xl bg-gradient-to-br from-[#fb7185] to-[#e11d48] text-[#e11d48]"><span className="text-white">{Icons.alert}</span></span>
            <div>
              <div className="text-[15px] font-semibold text-slate-900">Open escalations</div>
              <div className="text-xs text-slate-500">{escalations.length} waiting for a human</div>
            </div>
          </div>
          <div className="px-3 pb-3">
            {escalations.map((e) => (
              <Link key={e.id} to={`/calls/${e.conversation_id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition hover:bg-white">
                <Badge tone={e.priority === 'critical' ? 'red' : 'amber'}>{e.priority}</Badge>
                <span className="font-medium capitalize text-slate-900">{e.reason.replace('_', ' ')}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{e.summary}</span>
                <span className="whitespace-nowrap text-xs text-slate-400">{fmtDate(e.at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="card overflow-x-auto px-3 py-2">
        {data?.length ? (
          <table className="table">
            <thead><tr><th>Started</th><th>Channel</th><th>Status</th><th>Languages</th><th>Intents</th><th>Summary</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap"><Link className="font-medium text-slate-900 hover:text-brand-500" to={`/calls/${c.id}`}>{fmtDate(c.created_at)}</Link></td>
                <td className="whitespace-nowrap capitalize text-slate-600">{c.channel.replace('_', ' ')}</td>
                <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                <td>{c.languages_used.map((l) => LANGUAGES[l] ?? l).join(', ')}</td>
                <td><div className="flex flex-wrap gap-1">{c.intents.map((t) => <code key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{t}</code>)}</div></td>
                <td className="max-w-md text-xs text-slate-600">{c.summary ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="p-3"><Empty icon={Icons.chat}>No conversations yet. Start one from the Voice page.</Empty></div>}
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
      <PageHeader eyebrow="Transcript" title="Conversation" subtitle={`${fmtDate(c.created_at)} · ${c.channel.replace('_', ' ')}`}
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
