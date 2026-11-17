import { useCallback, useEffect, useRef, useState } from 'react'
import TalkingCharacter, { DEFAULT_LOOK, type CharacterLook, type Reaction } from '../components/TalkingCharacter'
import { Badge, ErrorNote, PageHeader } from '../components/ui'
import { useApi } from '../hooks/useApi'
import { session, voiceSocketUrl, voiceTicket } from '../services/api'
import { VoiceClient, type AgentState } from '../services/voiceClient'
import { LANGUAGES, type Agent } from '../types'

interface Line { role: 'user' | 'agent' | 'system'; text: string; language?: string | null; partial?: boolean }

const STATE_LABEL: Record<AgentState, string> = {
  connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking…', speaking: 'Speaking', ended: 'Call ended',
}

export default function VoiceConsole() {
  const { data: agents } = useApi<Agent[]>('/agents')
  const [agentId, setAgentId] = useState('')
  const [state, setState] = useState<AgentState | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [muted, setMuted] = useState(false)
  const [text, setText] = useState('')
  const [info, setInfo] = useState<Record<string, any> | null>(null)
  const client = useRef<VoiceClient | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [reaction, setReaction] = useState<Reaction>(null)
  const reactionTimer = useRef<number | undefined>(undefined)
  const react = (r: Reaction, ms: number) => {
    window.clearTimeout(reactionTimer.current)
    setReaction(r)
    reactionTimer.current = window.setTimeout(() => setReaction(null), ms)
  }

  // Character look is saved per agent in this browser.
  const agent = agents?.find((a) => a.id === agentId)
  const lookKey = `character:${agentId}:look`
  const [look, setLook] = useState<CharacterLook>(DEFAULT_LOOK)
  useEffect(() => {
    if (!agentId) return
    let saved: Partial<CharacterLook> | null = null
    try { saved = JSON.parse(localStorage.getItem(lookKey) || 'null') } catch { /* ignore */ }
    setLook({ ...DEFAULT_LOOK, name: agent?.name ?? DEFAULT_LOOK.name, ...(saved ?? {}) })
  }, [agentId, lookKey, agent?.name])
  const changeLook = (l: CharacterLook) => {
    setLook(l)
    try { localStorage.setItem(lookKey, JSON.stringify(l)) } catch { /* private mode */ }
  }
  const levels = useCallback(() => ({ mic: client.current?.micLevel ?? 0, agent: client.current?.agentLevel() ?? 0 }), [])

  useEffect(() => { if (agents?.length && !agentId) setAgentId(agents[0].id) }, [agents, agentId])
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [lines])
  useEffect(() => () => client.current?.hangup(), [])

  const push = (l: Line) => setLines((prev) => {
    // replace trailing partial user line with newer partial/final
    if (l.role === 'user' && prev.length && prev[prev.length - 1].role === 'user' && prev[prev.length - 1].partial) {
      return [...prev.slice(0, -1), l]
    }
    return [...prev, l]
  })

  const start = async (withMic: boolean) => {
    if (!agentId || !session.token) return
    setLines([]); setError(null); setInfo(null); setMuted(false)
    const c = new VoiceClient({
      onState: setState,
      onReady: (i) => {
        setInfo(i)
        // Use the agent's persona as the character's name unless the user customised it.
        const persona = (i.agent as { persona?: string } | undefined)?.persona
        let saved = false
        try { saved = !!localStorage.getItem(lookKey) } catch { /* ignore */ }
        if (persona && !saved) setLook((l) => ({ ...l, name: persona }))
      },
      onLevel: (v) => setLevel(v),
      onError: (m) => setError(m),
      onTranscript: (t) => push({ role: t.role, text: t.text, language: t.language, partial: !t.final }),
      onEvent: (e) => {
        if (e.type === 'handoff') { push({ role: 'system', text: `Escalated to a human (${e.reason}, priority ${e.priority})` }); react('concerned', 3000) }
        if (e.type === 'interrupt') { push({ role: 'system', text: 'Caller interrupted — agent stopped speaking' }); react('surprised', 800) }
        if (e.type === 'ended') { push({ role: 'system', text: `Call ended (${e.reason})` }); react('goodbye', 2500) }
      },
    })
    client.current = c
    try {
      await c.connect(voiceSocketUrl(agentId, await voiceTicket(agentId)), withMic)
    } catch (e) {
      setError(`Could not start: ${(e as Error).message}`)
      setState(null)
    }
  }

  const stop = () => { client.current?.hangup(); client.current = null; setState('ended'); react('goodbye', 2500) }
  const live = state && state !== 'ended'
  const toggleMute = () => { setMuted(!muted); client.current?.setMuted(!muted) }
  const lastAgentLine = [...lines].reverse().find((l) => l.role === 'agent')?.text

  const sendText = () => {
    if (!text.trim() || !client.current) return
    client.current.sendText(text.trim())
    setText('')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Voice Console" subtitle="Talk to a business's agent in the browser (Sarvam Saaras v4 → agent → Bulbul v4)." />
      <ErrorNote error={error} />
      {info && info.sarvam_configured === false && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The server has no <code>SARVAM_API_KEY</code>. Add it to <code>.env</code> and restart the backend to enable speech and AI replies.
        </div>
      )}
      <div className="card mb-4 flex flex-wrap items-end gap-4">
        <div className="min-w-60 flex-1">
          <label className="label">Agent</label>
          <select className="input" value={agentId} disabled={!!live} onChange={(e) => setAgentId(e.target.value)}>
            {agents?.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.industry.replace('_', ' ')}</option>)}
          </select>
        </div>
        {!live ? (
          <>
            <span className="text-sm text-slate-500">Tap the character to start talking. Drag it anywhere.</span>
            <button className="btn-ghost" onClick={() => start(false)} disabled={!agentId}>Text only</button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            <button className="btn bg-rose-600 hover:bg-rose-700" onClick={stop}>End call</button>
          </>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${state === 'speaking' ? 'bg-brand-500 animate-pulse' : state === 'listening' ? 'bg-emerald-500' : state === 'thinking' ? 'bg-amber-400 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-sm font-medium">{state ? STATE_LABEL[state] : 'Not connected'}</span>
            {info?.agent && <span className="text-xs text-slate-400">with {info.agent.persona}</span>}
          </div>
          <div className="h-2 w-40 overflow-hidden rounded bg-slate-100" title="Mic level">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, level * 250)}%` }} />
          </div>
        </div>
        <div ref={scroller} className="h-[28rem] space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
          {lines.length === 0 && <div className="pt-32 text-center text-sm text-slate-400">Start a call and speak in English or Tamil. You can interrupt the agent at any time.</div>}
          {lines.map((l, i) => l.role === 'system' ? (
            <div key={i} className="text-center text-xs text-slate-400">{l.text}</div>
          ) : (
            <div key={i} className={`flex ${l.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${l.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-slate-200'} ${l.partial ? 'opacity-60' : ''}`}>
                {l.text}
                {l.language && <div className="mt-1"><Badge tone={l.role === 'user' ? 'gray' : 'blue'}>{LANGUAGES[l.language] ?? l.language}</Badge></div>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder={live ? 'Type a message (also interrupts the agent)…' : 'Start a call first'} disabled={!live}
            value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendText()} />
          <button className="btn" disabled={!live || !text.trim()} onClick={sendText}>Send</button>
        </div>
      </div>

      <TalkingCharacter
        state={state}
        look={look}
        onLookChange={changeLook}
        levels={levels}
        caption={lastAgentLine}
        muted={muted}
        reaction={reaction}
        disabled={!agentId}
        onActivate={() => (live ? toggleMute() : start(true))}
        onEnd={stop}
        storageKey="voice-console-character"
      />
    </div>
  )
}
