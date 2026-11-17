import { useState } from 'react'
import { Badge, Empty, ErrorNote, PageHeader, fmtDate, statusTone } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { api } from '../services/api'
import type { KnowledgeDoc } from '../types'

export default function Knowledge() {
  const { data: docs, reload, error } = useApi<KnowledgeDoc[]>('/knowledge/documents')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ title: string; score: number; content: string }[] | null>(null)

  const upload = async (file: File) => {
    setBusy(true); setErr(null)
    const fd = new FormData()
    fd.append('file', file)
    try { await api('/knowledge/documents/upload', { method: 'POST', body: fd }); reload() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const addText = async () => {
    setBusy(true); setErr(null)
    try { await api('/knowledge/documents/text', { method: 'POST', json: { title, text, source_type: 'faq' } }); setTitle(''); setText(''); reload() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const act = async (path: string, method: string) => {
    try { await api(path, { method }); reload() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div>
      <PageHeader eyebrow="Knowledge" title="Knowledge Base" subtitle="Documents, FAQs and policies the agent can search. Retrieval is scoped to this business only." />
      <ErrorNote error={err || error} />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-2 text-sm font-semibold">Upload document</div>
          <p className="mb-3 text-xs text-slate-500">PDF, DOCX, TXT, MD or CSV (max 15 MB).</p>
          <input type="file" accept=".pdf,.docx,.txt,.md,.csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </div>
        <div className="card space-y-2">
          <div className="text-sm font-semibold">Add FAQ / policy text</div>
          <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input h-24" placeholder="Q&A or policy text…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" disabled={busy || !title || !text} onClick={addText}>Add</button>
        </div>
      </div>
      <div className="card mb-6">
        <div className="mb-2 text-sm font-semibold">Test retrieval</div>
        <div className="flex gap-2">
          <input className="input" placeholder="e.g. visiting hours" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-ghost" onClick={async () => setHits(await api(`/knowledge/search?q=${encodeURIComponent(q)}`))}>Search</button>
        </div>
        {hits && (hits.length ? hits.map((h, i) => (
          <div key={i} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><div className="text-xs text-slate-500">{h.title} · score {h.score}</div><div className="mt-1 whitespace-pre-wrap">{h.content.slice(0, 400)}</div></div>
        )) : <div className="mt-3 text-sm text-slate-400">No matches</div>)}
      </div>
      <div className="card overflow-x-auto">
        {docs?.length ? (
          <table className="table">
            <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Chunks</th><th>Added</th><th></th></tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">{d.title}{d.error && <div className="text-xs text-rose-600">{d.error}</div>}</td>
                <td>{d.source_type}</td><td><Badge tone={statusTone(d.status)}>{d.status}</Badge></td><td>{d.chunk_count}</td><td>{fmtDate(d.created_at)}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  <button className="btn-ghost" onClick={() => act(`/knowledge/documents/${d.id}/reindex`, 'POST')}>Reindex</button>
                  <button className="btn-ghost text-rose-600" onClick={() => confirm(`Delete "${d.title}"?`) && act(`/knowledge/documents/${d.id}`, 'DELETE')}>Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No documents yet.</Empty>}
      </div>
    </div>
  )
}
