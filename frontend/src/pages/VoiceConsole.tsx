import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterThumb, realisticModel } from '../components/RealisticAvatar'
import TalkingCharacter, { DEFAULT_LOOK, type CharacterLook, type Reaction } from '../components/TalkingCharacter'
import { ErrorNote } from '../components/ui'
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
  const lookKey = `character:v4:${agentId}:look`
  const [look, setLook] = useState<CharacterLook>(DEFAULT_LOOK)
  useEffect(() => {
    if (!agentId) return
    let saved: Partial<CharacterLook> | null = null
    try { saved = JSON.parse(localStorage.getItem(lookKey) || 'null') } catch { /* ignore */ }
    setLook({ ...DEFAULT_LOOK, ...(saved ?? {}) }) // a new look starts as the default character, with her own name
  }, [agentId, lookKey])
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

  const accent = realisticModel(look.realistic?.model).accent
  const dot = state === 'speaking' ? 'bg-brand-500' : state === 'listening' ? 'bg-emerald-500' : state === 'thinking' ? 'bg-amber-400' : state === 'connecting' ? 'bg-slate-400' : 'bg-slate-300'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="animate-rise relative mb-10 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[min(42rem,100vw)] -translate-x-1/2 rounded-full opacity-60 blur-3xl transition-[background] duration-700"
          style={{ background: `linear-gradient(90deg, ${accent[0]}, #dbe8ff, ${accent[1]}55)` }} />
        <div className="mx-auto mb-5 flex w-fit items-center gap-2.5 rounded-full bg-white/75 py-1.5 pl-1.5 pr-4 shadow-[var(--shadow-card)] ring-1 ring-black/5 backdrop-blur">
          <span className="relative">
            <CharacterThumb id={look.realistic?.model ?? DEFAULT_LOOK.realistic.model} size={34} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${dot} ${state === 'speaking' || state === 'thinking' ? 'animate-pulse' : ''}`} />
          </span>
          <span className="text-[14px] font-medium text-slate-900">{look.name}</span>
          <span className="text-[14px] text-slate-400">{state ? STATE_LABEL[state] : 'Ready to talk'}</span>
        </div>
        <h1 className="text-5xl font-semibold tracking-tight text-slate-900 md:text-6xl">Talk to <span className="text-gradient">{look.name}</span>.</h1>
        <p className="mx-auto mt-4 max-w-xl text-[19px] leading-relaxed text-slate-500">
          Tap the character to start a call in English or Tamil. Interrupt any time. Drag it anywhere. Right-click, long-press or press E to choose and style a character.
        </p>
      </div>
      <ErrorNote error={error} />
      {info && info.sarvam_configured === false && (
        <div className="mb-6 rounded-2xl bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
          The server has no <code>SARVAM_API_KEY</code>. Add it to <code>.env</code> and restart the backend to enable speech and AI replies.
        </div>
      )}

      <div className="animate-rise mb-6 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '80ms' }}>
        {agents && agents.length <= 4 ? (
          <div role="radiogroup" aria-label="Agent" className="inline-flex rounded-full bg-slate-200/70 p-1">
            {agents.map((a) => (
              <button key={a.id} role="radio" aria-checked={a.id === agentId} disabled={!!live} onClick={() => setAgentId(a.id)}
                className={`rounded-full px-4 py-1.5 text-sm transition-all duration-300 ${a.id === agentId ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'} disabled:cursor-not-allowed`}>
                {a.name}
              </button>
            ))}
          </div>
        ) : (
          <select className="input w-72" aria-label="Agent" value={agentId} disabled={!!live} onChange={(e) => setAgentId(e.target.value)}>
            {agents?.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.industry.replace('_', ' ')}</option>)}
          </select>
        )}
        {!live ? (
          <button className="btn-ghost" onClick={() => start(false)} disabled={!agentId}>Text only</button>
        ) : (
          <>
            <button className="btn-ghost" onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
            <button className="btn bg-rose-500 hover:bg-rose-600" onClick={stop}>End call</button>
          </>
        )}
      </div>

      <div className="card animate-rise overflow-hidden p-0" style={{ animationDelay: '160ms' }}>
        <div className="flex items-center justify-between bg-gradient-to-b from-slate-50/80 to-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${dot} ${state === 'speaking' || state === 'thinking' ? 'animate-pulse' : ''}`} />
            <span className="text-sm font-medium text-slate-900">{state ? STATE_LABEL[state] : 'Not connected'}</span>
            {info?.agent && <span className="text-sm text-slate-400">· {info.agent.persona}</span>}
          </div>
          <div className="flex h-4 items-end gap-0.5" title="Microphone level" aria-hidden>
            {[0.6, 1, 0.75, 0.9, 0.5].map((f, i) => (
              <span key={i} className="w-1 rounded-full bg-emerald-400 transition-all duration-100" style={{ height: `${Math.max(15, Math.min(100, level * 400 * f))}%` }} />
            ))}
          </div>
        </div>
        <div ref={scroller} className="h-[26rem] space-y-2 overflow-y-auto border-y border-slate-100 px-6 py-5">
          {lines.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-[15px] font-medium text-slate-700">No conversation yet</div>
              <div className="mt-1 text-sm text-slate-400">Your call transcript appears here as you talk.</div>
            </div>
          )}
          {lines.map((l, i) => l.role === 'system' ? (
            <div key={i} className="py-1 text-center text-xs text-slate-400">{l.text}</div>
          ) : (
            <div key={i} className={`flex ${l.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-[20px] px-4 py-2.5 text-[15px] leading-snug ${l.role === 'user' ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-slate-100 text-slate-900'} ${l.partial ? 'opacity-60' : ''}`}>
                {l.text}
                {l.language && <div className={`mt-1 text-[11px] ${l.role === 'user' ? 'text-white/70' : 'text-slate-400'}`}>{LANGUAGES[l.language] ?? l.language}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 p-3">
          <input className="input rounded-full" placeholder={live ? 'Message (also interrupts the agent)' : 'Start a call to send messages'} disabled={!live}
            value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendText()} />
          <button className="btn" disabled={!live || !text.trim()} onClick={sendText} aria-label="Send">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
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
