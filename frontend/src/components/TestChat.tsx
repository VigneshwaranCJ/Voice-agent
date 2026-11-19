import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../services/api'
import { LANGUAGES } from '../types'
import { Badge } from './ui'

interface ChatOut {
  conversation_id: string; reply: string; language: string; escalated: boolean
  tool_calls: { name: string }[]; events: { type: string; message?: string }[]
}
interface Line { role: 'user' | 'agent' | 'system'; text: string; language?: string; tools?: string[]; escalated?: boolean }

/** Chat with an agent's saved configuration over plain HTTP (same engine, tools and guardrails as voice calls).
 *  Works on hosts that block WebSockets, and doesn't need a microphone. */
export default function TestChat({ agentId, languages }: { agentId: string; languages: string[] }) {
  const [lines, setLines] = useState<Line[]>([])
  const [conv, setConv] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const convRef = useRef<string | null>(null)
  convRef.current = conv

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [lines, busy])
  // End the test conversation when leaving, so it shows as completed (with a summary) under Calls.
  useEffect(() => () => { if (convRef.current) api(`/conversations/${convRef.current}/end`, { method: 'POST' }).catch(() => {}) }, [agentId])

  const restart = async () => {
    if (conv) await api(`/conversations/${conv}/end`, { method: 'POST' }).catch(() => {})
    setConv(null); setLines([])
  }

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const msg = text.trim()
    if (!msg || busy) return
    setText(''); setBusy(true)
    setLines((l) => [...l, { role: 'user', text: msg }])
    try {
      const r = await api<ChatOut>(`/agents/${agentId}/chat`, { method: 'POST', json: { text: msg, conversation_id: conv, language: language || null } })
      setConv(r.conversation_id)
      const errors = r.events.filter((ev) => ev.type === 'error' && ev.message).map((ev) => ({ role: 'system' as const, text: ev.message! }))
      setLines((l) => [...l, ...errors, { role: 'agent', text: r.reply, language: r.language, tools: r.tool_calls.map((t) => t.name), escalated: r.escalated }])
    } catch (err) {
      setLines((l) => [...l, { role: 'system', text: `Could not get a reply: ${(err as Error).message}` }])
    } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Test chat</div>
          <div className="text-xs text-slate-500">Talks to the last saved version. Save your changes first to test them.</div>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Reply language" className="input py-1.5 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Auto language</option>
            {languages.map((l) => <option key={l} value={l}>{LANGUAGES[l] ?? l}</option>)}
          </select>
          <button className="btn-ghost" onClick={restart} disabled={!lines.length || busy}>New chat</button>
        </div>
      </div>
      <div ref={scroller} className="h-72 space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3">
        {!lines.length && <div className="pt-24 text-center text-sm text-slate-400">Ask what a customer would ask, e.g. “What are your opening hours?”</div>}
        {lines.map((l, i) => l.role === 'system' ? (
          <div key={i} className="text-center text-xs text-rose-600">{l.text}</div>
        ) : (
          <div key={i} className={`flex ${l.role === 'user' ? 'justify-end' : ''}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${l.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-black/5'}`}>
              <div className="whitespace-pre-wrap">{l.text}</div>
              {l.role === 'agent' && (!!l.tools?.length || l.escalated || l.language) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                  {l.language && <span>{LANGUAGES[l.language] ?? l.language}</span>}
                  {l.tools?.map((t) => <code key={t} className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">{t}</code>)}
                  {l.escalated && <Badge tone="red">handed to a person</Badge>}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-slate-400">Agent is typing…</div>}
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input className="input" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
        <button className="btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  )
}
