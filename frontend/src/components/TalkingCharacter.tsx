/**
 * Talking character: the voice agent's on-screen body.
 *
 * - A portrait tile with a ring that shows the call state (listening, thinking, speaking, muted) and
 *   pulses with the voice, plus a name tag. Each character has its own accent colours.
 * - Tap / Enter starts a call (replaces the "Start" button); during a call, tap toggles mute.
 * - Drag it anywhere (or focus it and use the arrow keys); position is remembered.
 * - Pick a character (3D photo portrait or 3D model), name, colours and size in the editor; saved per agent.
 * - Acts on the voice: lip-syncs to the agent's audio loudness and reacts to listening, thinking and
 *   goodbye (see PhotoAvatar / RealisticAvatar for the animation).
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentState } from '../services/voiceClient'
import RealisticAvatar, {
  CharacterThumb, DEFAULT_REALISTIC, REALISTIC_MODELS, REAL_HAIR, REAL_OUTFIT, REAL_SKIN, realisticModel,
  type RealisticDriver, type RealisticLook, type RealisticMood,
} from './RealisticAvatar'

export type CharacterSize = 'sm' | 'md' | 'lg'
export type Reaction = 'surprised' | 'concerned' | 'goodbye' | null

export interface CharacterLook {
  name: string
  realistic: RealisticLook
  size: CharacterSize
}

export const DEFAULT_LOOK: CharacterLook = { name: 'Kavya', realistic: DEFAULT_REALISTIC, size: 'md' }

const SIZE_PX: Record<CharacterSize, number> = { sm: 132, md: 172, lg: 220 }
const SIZE_NAME: Record<CharacterSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' }

interface Props {
  state: AgentState | null
  look: CharacterLook
  onLookChange: (l: CharacterLook) => void
  /** Called every frame; return current loudness of caller mic and agent voice. */
  levels: () => { mic: number; agent: number }
  caption?: string
  muted?: boolean
  reaction?: Reaction
  disabled?: boolean
  onActivate: () => void
  onEnd?: () => void
  storageKey?: string
}

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'muted'
const phaseOf = (state: AgentState | null, muted?: boolean): Phase =>
  !state || state === 'ended' ? 'idle' : muted ? 'muted' : state

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready', connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', muted: 'Muted',
}
const PHASE_DOT: Record<Phase, string> = {
  idle: 'bg-white', connecting: 'bg-slate-300', listening: 'bg-emerald-400', thinking: 'bg-amber-400', speaking: 'bg-sky-400', muted: 'bg-rose-500',
}

/** Ring colours and spin speed per call phase; idle and speaking wear the character's own accent. */
function ringStyle(phase: Phase, accent: [string, string]) {
  const [a, b] = accent
  switch (phase) {
    case 'connecting': return { colors: '#cbd5e1, #f8fafc, #94a3b8, #cbd5e1', spin: '1.1s', glow: '#94a3b8' }
    case 'listening': return { colors: '#34d399, #d1fae5, #10b981, #34d399', spin: '4s', glow: '#34d399' }
    case 'thinking': return { colors: '#fbbf24, #fef3c7, #f59e0b, #fbbf24', spin: '1.3s', glow: '#fbbf24' }
    case 'speaking': return { colors: `${b}, #ffffff, ${a}, #5ea8ff, ${b}`, spin: '2.6s', glow: b }
    case 'muted': return { colors: '#fb7185, #fecdd3, #f43f5e, #fb7185', spin: '0s', glow: '#fb7185' }
    default: return { colors: `${a}, #ffffff, ${b}, ${a}`, spin: '9s', glow: b }
  }
}

function loadPos(key: string): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null
  } catch { return null }
}

/**
 * The character's portrait card: ring (state colour, pulses with the voice through the --lvl CSS
 * variable), the avatar itself, a soft bottom scrim and a name tag.
 */
export function AvatarTile({ look, name, phase, driver, width, height, levelRef, showTag = true }: {
  look: RealisticLook
  name: string
  phase: Phase
  driver?: { current: RealisticDriver }
  width: number
  height: number
  /** element whose --lvl (0..1) the caller animates */
  levelRef?: React.Ref<HTMLDivElement>
  showTag?: boolean
}) {
  const m = realisticModel(look.model)
  const ring = ringStyle(phase, m.accent)
  const radius = Math.round(width * 0.18)
  const small = width < 150
  return (
    <div ref={levelRef} className="relative p-[3px] [--lvl:0]"
      style={{
        borderRadius: radius + 3,
        boxShadow: `0 18px 44px -16px rgb(0 0 0 / 0.45), 0 0 calc(4px + var(--lvl) * 36px) calc(var(--lvl) * 5px) ${ring.glow}99`,
        transform: 'scale(calc(1 + var(--lvl) * 0.018))',
        transition: 'box-shadow 90ms linear, transform 90ms linear',
      }}>
      <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius + 3 }}>
        <div className={`absolute -inset-[60%] ${ring.spin !== '0s' ? 'ring-spin' : ''}`}
          style={{ background: `conic-gradient(from 0deg, ${ring.colors})`, ['--spin' as string]: ring.spin }} />
      </div>
      <div className="relative overflow-hidden bg-slate-200" style={{ borderRadius: radius }}>
        <RealisticAvatar look={look} driver={driver} width={width} height={height} />
        {showTag && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/50 via-black/15 to-transparent" />
            <div className={`absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-white ${small ? 'text-[11px]' : 'text-[12.5px]'}`}>
              <span className="min-w-0 truncate font-semibold tracking-tight drop-shadow">{name || m.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 font-medium backdrop-blur-md">
                <span className={`h-1.5 w-1.5 rounded-full ${PHASE_DOT[phase]} ${phase === 'thinking' || phase === 'connecting' ? 'animate-pulse' : ''}`} />
                {PHASE_LABEL[phase]}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function TalkingCharacter(props: Props) {
  const { state, look, onLookChange, levels, caption, muted, reaction, disabled, onActivate, onEnd } = props
  const posKey = `${props.storageKey ?? 'character'}:pos`
  const size = SIZE_PX[look.size]
  const tileW = size, tileH = Math.round(size * 1.25)
  const live = !!state && state !== 'ended'
  const phase = phaseOf(state, muted)

  // ---- position & dragging ------------------------------------------------------------------------
  // Keep the whole widget on screen: the speech bubble above it and the toolbar below it included.
  const rootRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const clamp = useCallback((p: { x: number; y: number }) => {
    const above = (bubbleRef.current?.offsetHeight ?? 64) + 14
    const height = rootRef.current?.offsetHeight ?? tileH + 60
    return {
      x: Math.max(8, Math.min(window.innerWidth - tileW - 8, p.x)),
      y: Math.max(8 + above, Math.min(window.innerHeight - height - 8, p.y)),
    }
  }, [tileW, tileH])
  const [pos, setPos] = useState(() => loadPos(posKey) ?? { x: window.innerWidth - tileW - 40, y: window.innerHeight - tileH - 100 })
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean; long: boolean } | null>(null)
  const longTimer = useRef<number | undefined>(undefined)
  const [editing, setEditing] = useState(false)

  useEffect(() => { setPos((p) => clamp(p)) }, [clamp])
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])
  const savePos = (p: { x: number; y: number }) => { try { localStorage.setItem(posKey, JSON.stringify(p)) } catch { /* private mode */ } }

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, sx: e.clientX, sy: e.clientY, moved: false, long: false }
    // Long-press (touch or mouse) opens the editor.
    window.clearTimeout(longTimer.current)
    longTimer.current = window.setTimeout(() => {
      if (drag.current && !drag.current.moved) { drag.current.long = true; setEditing(true) }
    }, 550)
  }
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
    d.moved = true
    window.clearTimeout(longTimer.current)
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }))
  }
  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current
    drag.current = null
    window.clearTimeout(longTimer.current)
    if (!d || d.long) return
    if (d.moved) {
      // Save where the pointer actually ended, not the last rendered position (a fast flick can end
      // before React has rendered the final move).
      const p = clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy })
      setPos(p); savePos(p)
    } else if (!disabled) onActivate()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 60 : 20
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dx, dy] = moves[e.key]
      setPos((cur) => { const p = clamp({ x: cur.x + dx, y: cur.y + dy }); savePos(p); return p })
    } else if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault(); onActivate()
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault(); setEditing(true)
    }
  }

  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const realDriver = useRef<RealisticDriver>({ state, reaction: reaction ?? null, level: () => levelsRef.current().agent })
  realDriver.current.state = state
  realDriver.current.reaction = reaction ?? null
  const realLook = { ...DEFAULT_REALISTIC, ...(look.realistic ?? {}) }

  // ---- voice-reactive ring: agent loudness while speaking, the caller's while listening ----------
  const tileRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  useEffect(() => {
    let raf = 0
    let v = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = phaseRef.current
      const l = levelsRef.current()
      const target = p === 'speaking' ? Math.min(1, l.agent * 1.6) : p === 'listening' ? Math.min(1, l.mic * 3) : 0
      v += (target - v) * (target > v ? 0.35 : 0.12)
      tileRef.current?.style.setProperty('--lvl', v < 0.005 ? '0' : v.toFixed(3))
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Edits build on the latest look we sent up, so two quick clicks before the parent re-renders
  // don't overwrite each other.
  const latestLook = useRef(look)
  useEffect(() => { latestLook.current = look }, [look])
  const commitLook = (l: CharacterLook) => { latestLook.current = l; onLookChange(l) }
  const setReal = (patch: Partial<RealisticLook>) => {
    const cur = latestLook.current
    commitLook({ ...cur, realistic: { ...DEFAULT_REALISTIC, ...(cur.realistic ?? {}), ...patch } })
  }
  const set = <K extends keyof CharacterLook>(k: K, v: CharacterLook[K]) => commitLook({ ...latestLook.current, [k]: v })

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const bubble = disabled ? { head: 'No agent', text: 'Pick an agent first' }
    : phase === 'idle' ? { head: `Hi, I'm ${look.name}`, text: 'Tap me to start a call' }
      : phase === 'connecting' ? { head: 'Connecting', text: 'One moment…' }
        : phase === 'muted' ? { head: 'Muted', text: 'Tap me to unmute' }
          : phase === 'listening' ? { head: 'Listening', text: "Go ahead, I'm listening." }
            : phase === 'thinking' ? { head: 'Thinking', text: 'Let me check that for you…' }
              : { head: 'Speaking', text: caption || '…' }
  const headTone = phase === 'listening' ? 'text-emerald-600' : phase === 'thinking' ? 'text-amber-600' : phase === 'muted' ? 'text-rose-600' : phase === 'speaking' ? 'text-sky-600' : 'text-slate-500'

  const bubbleLeft = pos.x + tileW / 2 > window.innerWidth / 2
  const cursorLabel = disabled ? 'Pick an agent' : !live ? 'Tap to talk' : muted ? 'Tap to unmute' : 'Tap to mute'
  const resetPos = () => {
    const p = clamp({ x: window.innerWidth - tileW - 40, y: window.innerHeight - tileH - 100 })
    setPos(p); savePos(p)
  }
  const model = realisticModel(realLook.model)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640

  return (
    <div ref={rootRef} className="pointer-events-none fixed z-40 select-none" style={{ left: pos.x, top: pos.y, width: tileW }}>
      {/* speech bubble */}
      <div ref={bubbleRef} aria-live="polite"
        className={`glass pointer-events-auto absolute bottom-full mb-3.5 w-64 rounded-[20px] px-4 py-3 shadow-[var(--shadow-float)] ring-1 ring-black/5 ${bubbleLeft ? 'right-[18%]' : 'left-[18%]'}`}>
        <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${headTone}`}>
          {phase === 'speaking' && (
            <span aria-hidden className="eq flex h-3 items-end gap-[2px]">
              <span className="h-full w-[3px] rounded-full bg-current" /><span className="h-full w-[3px] rounded-full bg-current" /><span className="h-full w-[3px] rounded-full bg-current" />
            </span>
          )}
          <span className="truncate">{bubble.head}</span>
        </div>
        <p className="mt-1 line-clamp-3 text-[14px] leading-snug text-slate-800">{bubble.text}</p>
        <span aria-hidden className={`glass absolute -bottom-1.5 h-3.5 w-3.5 rotate-45 rounded-[3px] ring-1 ring-black/5 [clip-path:polygon(100%_0,100%_100%,0_100%)] ${bubbleLeft ? 'right-8' : 'left-8'}`} />
      </div>

      <div
        role="button"
        tabIndex={0}
        data-cursor={cursorLabel}
        aria-label={`${live ? `${look.name}: ${bubble.head}. Enter to ${muted ? 'unmute' : 'mute'}` : `Start a voice call with ${look.name}. Enter to start`}. E to edit. Arrow keys move.`}
        aria-disabled={disabled}
        className={`pointer-events-auto touch-none rounded-[2rem] outline-none transition-transform duration-500 ease-[var(--ease-apple)] hover:-translate-y-1 focus-visible:ring-4 focus-visible:ring-brand-500/30 ${disabled ? 'opacity-60 grayscale' : ''}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; window.clearTimeout(longTimer.current) }}
        onContextMenu={(e) => { e.preventDefault(); setEditing(true) }}
        onKeyDown={onKeyDown}
      >
        <AvatarTile look={realLook} name={look.name} phase={phase} driver={realDriver} width={tileW} height={tileH} levelRef={tileRef} />
      </div>

      {/* glass toolbar */}
      <div className="pointer-events-auto mt-3 flex justify-center">
        <div className="glass flex items-center gap-1 rounded-full p-1 shadow-[var(--shadow-float)] ring-1 ring-black/5">
          {!live ? (
            <button type="button" onClick={() => !disabled && onActivate()} disabled={disabled} aria-label={`Talk to ${look.name}`}
              className="flex h-9 items-center gap-1.5 rounded-full bg-brand-500 pl-3 pr-3.5 text-[13px] font-semibold text-white transition duration-300 hover:bg-brand-600 active:scale-95 disabled:opacity-40">
              <IconMic /> Talk
            </button>
          ) : (
            <ToolButton label={muted ? 'Unmute' : 'Mute'} onClick={onActivate} tone={muted ? 'danger' : 'soft'}>
              {muted ? <IconMicOff /> : <IconMic />}
            </ToolButton>
          )}
          <ToolButton label="Edit character" onClick={() => setEditing(true)}><IconSliders /></ToolButton>
          {live && onEnd && <ToolButton label="End call" onClick={onEnd} tone="danger"><IconPhoneDown /></ToolButton>}
        </div>
      </div>

      {editing && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Edit character">
          <div className="animate-fade absolute inset-0 bg-slate-900/30 backdrop-blur-md" onClick={() => setEditing(false)} />
          <div className="animate-rise relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[28px] bg-[#f5f5f7] shadow-[0_30px_80px_rgb(0_0_0/0.3)] sm:rounded-[28px]" style={{ animationDuration: '0.45s' }}>
            <div className="glass sticky top-0 z-10 flex items-center justify-between border-b border-black/5 px-5 py-3.5">
              <button className="rounded-full px-2 py-1 text-[15px] text-brand-500 hover:bg-brand-50" onClick={() => commitLook({ ...DEFAULT_LOOK, size: latestLook.current.size })}>Reset</button>
              <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">Character</h2>
              <button className="rounded-full px-2 py-1 text-[15px] font-semibold text-brand-500 hover:bg-brand-50" onClick={() => setEditing(false)}>Done</button>
            </div>
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:overflow-hidden">
              {/* live preview */}
              <div className="relative flex flex-col items-center justify-center gap-5 px-6 py-8">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70"
                  style={{ background: `radial-gradient(60% 50% at 50% 40%, ${model.accent[0]}, transparent 70%)` }} />
                <div className="relative">
                  <AvatarTile look={realLook} name={look.name} phase="idle" width={narrow ? 168 : 236} height={narrow ? 210 : 295} showTag={false} />
                </div>
                <div className="relative w-full max-w-xs text-center">
                  <input aria-label="Character name" className="w-full rounded-xl bg-transparent px-2 py-1 text-center text-[28px] font-semibold tracking-tight text-slate-900 outline-none transition placeholder:text-slate-300 hover:bg-white/60 focus:bg-white"
                    value={look.name} maxLength={24} placeholder="Name" onChange={(e) => set('name', e.target.value)} />
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[12px]">
                    <Chip>{model.kind === 'photo' ? '3D photo portrait' : '3D character'}</Chip>
                    <Chip tone={model.commercial ? 'good' : 'warn'}>{model.commercial ? 'OK to sell' : 'Demo only'}</Chip>
                  </div>
                </div>
              </div>

              {/* controls */}
              <div className="min-h-0 space-y-6 px-5 pb-8 pt-2 md:overflow-y-auto md:pt-6">
                <Section title="Choose a character">
                  <div role="radiogroup" aria-label="Character" className="grid grid-cols-3 gap-2 p-2 sm:grid-cols-4">
                    {REALISTIC_MODELS.map((m) => {
                      const on = realLook.model === m.id
                      return (
                        <button key={m.id} type="button" role="radio" aria-checked={on} onClick={() => {
                            // Picking a character also gives it its name and signature colours.
                            const cur = latestLook.current
                            commitLook({ ...cur, name: m.name, realistic: { ...DEFAULT_REALISTIC, ...(cur.realistic ?? {}), model: m.id, ...m.tints } })
                          }}
                          className={`group relative flex flex-col items-center rounded-2xl px-1.5 pb-2 pt-3 transition duration-300 active:scale-95 ${on ? 'bg-white shadow-[0_4px_14px_-4px_rgb(0_0_0/0.18)] ring-2 ring-brand-500' : 'hover:bg-white/70'}`}>
                          <CharacterThumb id={m.id} size={52} className="transition duration-300 group-hover:scale-105" />
                          <span className="mt-1.5 w-full truncate text-center text-[12.5px] font-medium text-slate-900" title={m.name}>{m.name}</span>
                          <span className={`text-[10.5px] ${m.commercial ? 'text-slate-400' : 'text-amber-600'}`}>{m.kind === 'photo' ? 'Photo' : m.commercial ? '3D' : '3D · Demo'}</span>
                          {on && (
                            <span aria-hidden className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-white">
                              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {!model.commercial && (
                    <p className="mx-2 mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
                      {model.name} ({model.credit}) is licensed for non-commercial use only. Use Kavya, Amara, Nandhini, Divyadharshini or your own model before selling this product.
                    </p>
                  )}
                </Section>

                {model.kind === '3d' && (
                  <Section title="Appearance">
                    <SwatchRow label="Skin" options={REAL_SKIN} value={realLook.skin} onChange={(v) => setReal({ skin: v })} />
                    {model.groups.hair.length > 0 && <SwatchRow label="Hair" options={REAL_HAIR} value={realLook.hair} onChange={(v) => setReal({ hair: v })} />}
                    <SwatchRow label="Outfit" options={REAL_OUTFIT} value={realLook.outfit} onChange={(v) => setReal({ outfit: v })} />
                    <Row label="Expression">
                      <Segmented options={['happy', 'neutral', 'love'] as RealisticMood[]} value={realLook.mood} onChange={(v) => setReal({ mood: v })} />
                    </Row>
                  </Section>
                )}

                <Section title="Display">
                  <Row label="Framing">
                    <Segmented options={['upper', 'head'] as RealisticLook['framing'][]} labels={{ upper: 'Shoulders', head: 'Close-up' }} value={realLook.framing} onChange={(v) => setReal({ framing: v })} />
                  </Row>
                  <Row label="Size">
                    <Segmented options={['sm', 'md', 'lg'] as CharacterSize[]} labels={SIZE_NAME} value={look.size} onChange={(v) => set('size', v)} />
                  </Row>
                  <button className="flex w-full items-center justify-between px-4 py-3 text-left text-[14px] text-brand-500 transition hover:bg-white/70" onClick={resetPos}>
                    Move back to the corner
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7M9 7h8v8" /></svg>
                  </button>
                </Section>

                <p className="px-1 text-[12px] leading-relaxed text-slate-400">
                  {model.kind === 'photo'
                    ? 'Your portrait, rendered in 3D with depth, blinking and voice-driven lips.'
                    : <>3D by <a className="underline hover:text-slate-600" href="https://github.com/met4citizen/TalkingHead" target="_blank" rel="noreferrer">TalkingHead</a> (Mika Suominen, MIT) · model: {model.credit}.</>}
                  {' '}Right-click or long-press the character, or press E, to open this panel.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-400">{title}</h3>
      <div className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl bg-white/80 ring-1 ring-black/[0.05]">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="text-[14px] text-slate-900">{label}</span>
      {children}
    </div>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' }) {
  const c = tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-white/80 text-slate-600'
  return <span className={`rounded-full px-2.5 py-1 font-medium ring-1 ring-black/5 ${c}`}>{children}</span>
}

function SwatchRow({ label, options, value, onChange }: {
  label: string; options: { v: string; n: string }[]; value: string; onChange: (v: string) => void
}) {
  const current = options.find((o) => o.v === value)?.n ?? 'Custom'
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] text-slate-900">{label}</span>
        <span className="text-[13px] text-slate-400">{current}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        {options.map((o) => (
          <button key={o.v} type="button" title={o.n} aria-label={`${label}: ${o.n}`} aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={`h-8 w-8 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] transition duration-300 hover:scale-110 active:scale-90 ${value === o.v ? 'ring-2 ring-brand-500 ring-offset-2' : ''}`}
            style={{ background: o.v === '#ffffff' ? 'conic-gradient(from 210deg, #f4d7c4, #c9a27e, #8c6a55, #f4d7c4)' : o.v }} />
        ))}
      </div>
    </div>
  )
}

function ToolButton({ label, onClick, children, disabled, tone }: {
  label: string; onClick: () => void; children: ReactNode; disabled?: boolean; tone?: 'soft' | 'danger'
}) {
  const color = tone === 'danger' ? 'bg-rose-500 text-white hover:bg-rose-600' : tone === 'soft' ? 'bg-slate-900/[0.06] text-slate-800 hover:bg-slate-900/[0.1]' : 'text-slate-700 hover:bg-slate-900/[0.06]'
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition duration-300 active:scale-90 disabled:opacity-40 ${color}`}>
      {children}
    </button>
  )
}

const svgIcon = 'h-[18px] w-[18px]'
const IconMic = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>)
const IconMicOff = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5 2.2M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18" /></svg>)
const IconSliders = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>)
const IconPhoneDown = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="currentColor" aria-hidden><path d="M12 9c-3.2 0-6.2.9-8.6 2.6-.6.4-.8 1.2-.5 1.9l1 2c.3.6 1 .9 1.7.7l2.6-.9c.6-.2 1-.8 1-1.4v-1.6a12 12 0 0 1 5.6 0v1.6c0 .6.4 1.2 1 1.4l2.6.9c.7.2 1.4-.1 1.7-.7l1-2c.3-.7.1-1.5-.5-1.9C18.2 9.9 15.2 9 12 9z" /></svg>)

function Segmented<T extends string>({ options, value, onChange, labels }: { options: T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <div className="inline-flex gap-0.5 rounded-[10px] bg-slate-900/[0.06] p-0.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o}
          className={`rounded-[8px] px-3 py-1 text-[13px] ${labels ? "" : "capitalize"} transition-all duration-300 ${value === o ? 'bg-white font-medium text-slate-900 shadow-[0_1px_3px_rgb(0_0_0/0.12)]' : 'text-slate-600 hover:text-slate-900'}`}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  )
}
