/**
 * Talking character: the voice agent's on-screen body.
 *
 * - Tap / Enter starts a call (replaces the "Start" button); during a call, tap toggles mute.
 * - Drag it anywhere (or focus it and use the arrow keys); position is remembered.
 * - Pick a realistic character (animated photo portrait or 3D model), name, colours and size; saved per agent.
 * - Acts on the voice: lip-syncs to the agent's audio loudness and reacts to listening, thinking and
 *   goodbye (see PhotoAvatar / RealisticAvatar for the animation).
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentState } from '../services/voiceClient'
import RealisticAvatar, {
  DEFAULT_REALISTIC, REALISTIC_MODELS, REAL_HAIR, REAL_OUTFIT, REAL_SKIN, realisticModel,
  type RealisticDriver, type RealisticLook, type RealisticMood,
} from './RealisticAvatar'

export type CharacterSize = 'sm' | 'md' | 'lg'
export type Reaction = 'surprised' | 'concerned' | 'goodbye' | null

export interface CharacterLook {
  name: string
  realistic: RealisticLook
  size: CharacterSize
}

export const DEFAULT_LOOK: CharacterLook = { name: 'Assistant', realistic: DEFAULT_REALISTIC, size: 'md' }

const SIZE_PX: Record<CharacterSize, number> = { sm: 130, md: 170, lg: 220 }

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


function loadPos(key: string): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null
  } catch { return null }
}

export default function TalkingCharacter(props: Props) {
  const { state, look, onLookChange, levels, caption, muted, reaction, disabled, onActivate, onEnd } = props
  const posKey = `${props.storageKey ?? 'character'}:pos`
  const size = SIZE_PX[look.size]
  const live = !!state && state !== 'ended'

  // ---- position & dragging ------------------------------------------------------------------------
  // Keep the whole widget on screen: the speech bubble above it and the toolbar below it included.
  const rootRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const clamp = useCallback((p: { x: number; y: number }) => {
    const above = (bubbleRef.current?.offsetHeight ?? 48) + 8
    const height = rootRef.current?.offsetHeight ?? size * 1.25 + 52
    return {
      x: Math.max(8, Math.min(window.innerWidth - size - 8, p.x)),
      y: Math.max(8 + above, Math.min(window.innerHeight - height - 8, p.y)),
    }
  }, [size])
  const [pos, setPos] = useState(() => loadPos(posKey) ?? { x: window.innerWidth - size - 40, y: window.innerHeight - size * 1.3 - 40 })
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean; long: boolean } | null>(null)
  const longTimer = useRef<number | undefined>(undefined)
  const [editing, setEditing] = useState(false)

  useEffect(() => { setPos((p) => clamp(p)) }, [clamp, look.style])
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
  // Edits build on the latest look we sent up, so two quick clicks before the parent re-renders
  // don't overwrite each other.
  const latestLook = useRef(look)
  useEffect(() => { latestLook.current = look }, [look])
  const commitLook = (l: CharacterLook) => { latestLook.current = l; onLookChange(l) }
  const setReal = (patch: Partial<RealisticLook>) => {
    const cur = latestLook.current
    commitLook({ ...cur, realistic: { ...DEFAULT_REALISTIC, ...(cur.realistic ?? {}), ...patch } })
  }

  // ---- editor ----------------------------------------------------------------------------------------
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])
  const set = <K extends keyof CharacterLook>(k: K, v: CharacterLook[K]) => commitLook({ ...latestLook.current, [k]: v })

  const status = disabled ? 'Pick an agent first'
    : !state || state === 'ended' ? `Tap me to talk to ${look.name}`
      : state === 'connecting' ? 'Connecting…'
        : muted ? 'Muted — tap me to unmute'
          : state === 'listening' ? "I'm listening…"
            : state === 'thinking' ? 'Let me check…'
              : caption || '…'

  const bubbleLeft = pos.x + size / 2 > window.innerWidth / 2
  const cursorLabel = disabled ? 'Pick an agent' : !live ? 'Tap to talk' : muted ? 'Tap to unmute' : 'Tap to mute'
  const resetPos = () => {
    const p = clamp({ x: window.innerWidth - size - 40, y: window.innerHeight - size * 1.3 - 40 })
    setPos(p); savePos(p)
  }
  return (
    <div ref={rootRef} className="pointer-events-none fixed z-40 select-none" style={{ left: pos.x, top: pos.y, width: size }}>
      {/* speech bubble */}
      <div ref={bubbleRef} className={`glass pointer-events-auto absolute bottom-full mb-2 w-64 rounded-2xl px-4 py-2.5 text-[13px] leading-snug text-slate-800 shadow-[var(--shadow-float)] ring-1 ring-black/5 ${bubbleLeft ? 'right-1/3' : 'left-1/3'}`}
        aria-live="polite">
        <span className="line-clamp-3">{status}</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        data-cursor={cursorLabel}
        aria-label={`${live ? `${look.name}: ${status}. Enter to ${muted ? 'unmute' : 'mute'}` : `Start a voice call with ${look.name}. Enter to start`}. E to edit. Arrow keys move.`}
        aria-disabled={disabled}
        className={`group pointer-events-auto touch-none rounded-[2rem] outline-none transition-transform duration-500 ease-[var(--ease-apple)] hover:-translate-y-1 hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-brand-500/30 ${disabled ? 'opacity-60' : ''}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; window.clearTimeout(longTimer.current) }}
        onContextMenu={(e) => { e.preventDefault(); setEditing(true) }}
        onKeyDown={onKeyDown}
      >
        <div className="relative">
          <RealisticAvatar look={realLook} driver={realDriver} width={size * 1.15} height={size * 1.25} className="-mx-[7.5%]" />
          {live && <span className={`absolute bottom-3 right-4 h-3 w-3 rounded-full ring-2 ring-white ${muted ? 'bg-rose-500' : 'bg-emerald-400'}`} />}
          {state === 'thinking' && <span className="absolute right-3 top-2 animate-pulse text-2xl text-slate-400">…</span>}
          {state === 'listening' && <span className="pointer-events-none absolute inset-x-[10%] bottom-0 h-1 animate-pulse rounded-full bg-emerald-400/70" />}
        </div>
      </div>

      {/* glass toolbar */}
      <div className="pointer-events-auto mt-2 flex justify-center">
        <div className="glass flex items-center gap-1 rounded-full p-1 shadow-[var(--shadow-float)] ring-1 ring-black/5">
          <ToolButton label={!live ? 'Talk' : muted ? 'Unmute' : 'Mute'} onClick={() => !disabled && onActivate()} disabled={disabled}
            tone={live && muted ? 'danger' : 'primary'}>
            {live && muted ? <IconMicOff /> : <IconMic />}
          </ToolButton>
          <ToolButton label="Edit character" onClick={() => setEditing(true)}><IconPencil /></ToolButton>
          {live && onEnd && <ToolButton label="End call" onClick={onEnd} tone="danger"><IconPhoneDown /></ToolButton>}
        </div>
      </div>

      {editing && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit character">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={() => setEditing(false)} />
          <div className="animate-rise relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgb(0_0_0/0.25)]" style={{ animationDuration: '0.45s' }}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => commitLook({ ...DEFAULT_LOOK, name: latestLook.current.name, size: latestLook.current.size })}>Reset</button>
              <h2 className="text-[17px] font-semibold text-slate-900">Edit character</h2>
              <button className="text-sm font-semibold text-brand-500 hover:text-brand-600" onClick={() => setEditing(false)}>Done</button>
            </div>
            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              {/* live preview */}
              <div className="flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-50 to-slate-100 p-8">
                <div className="rounded-[2rem] bg-white/70 p-3 shadow-[var(--shadow-card)]">
                  <RealisticAvatar look={realLook} width={220} height={260} />
                </div>
                <input aria-label="Character name" className="w-56 bg-transparent text-center text-2xl font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
                  value={look.name} maxLength={24} placeholder="Name" onChange={(e) => set('name', e.target.value)} />
              </div>
              {/* controls */}
              <div className="min-h-0 space-y-4 overflow-y-auto p-6 text-sm">
                    <div>
                      <span className="label">Character</span>
                      <div role="radiogroup" aria-label="Realistic character" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {REALISTIC_MODELS.map((m) => (
                          <button key={m.id} type="button" role="radio" aria-checked={realLook.model === m.id} onClick={() => {
                              // Picking a character also gives it its name.
                              const cur = latestLook.current
                              commitLook({ ...cur, name: m.name, realistic: { ...DEFAULT_REALISTIC, ...(cur.realistic ?? {}), model: m.id, ...m.tints } })
                            }}
                            className={`rounded-2xl px-2 py-2.5 text-center ring-1 transition duration-300 active:scale-95 ${realLook.model === m.id ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
                            {m.kind === 'photo' && m.portrait
                              ? <span className="mx-auto block h-8 w-8 rounded-full bg-cover ring-1 ring-black/10" style={{ backgroundImage: `url(${m.portrait.src})`, backgroundPosition: `${m.portrait.frames.head.x * 100}% ${m.portrait.frames.head.y * 80}%`, backgroundSize: '260%' }} />
                              : <span className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f472b6] to-[#8e5cf7] text-sm font-semibold text-white">{m.name[0]}</span>}
                            <span className="mt-1 block truncate text-[12px] font-medium text-slate-900" title={m.name}>{m.name}</span>
                            <span className={`block text-[10px] ${m.commercial ? 'text-emerald-600' : 'text-amber-600'}`}>{m.kind === 'photo' ? 'Photo' : m.commercial ? '3D · OK to sell' : '3D · Demo only'}</span>
                          </button>
                        ))}
                      </div>
                      {!realisticModel(realLook.model).commercial && (
                        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
                          {realisticModel(realLook.model).name} ({realisticModel(realLook.model).credit}) is licensed for non-commercial use only. Use Nandhini, Divyadharshini or your own model before selling this product.
                        </p>
                      )}
                    </div>
                    {realisticModel(realLook.model).kind === '3d' && (
                      <>
                        <NamedSwatches label="Skin tone" options={REAL_SKIN} value={realLook.skin} onChange={(v) => setReal({ skin: v })} />
                        {realisticModel(realLook.model).groups.hair.length > 0 && <NamedSwatches label="Hair colour" options={REAL_HAIR} value={realLook.hair} onChange={(v) => setReal({ hair: v })} />}
                        <NamedSwatches label="Outfit" options={REAL_OUTFIT} value={realLook.outfit} onChange={(v) => setReal({ outfit: v })} />
                        <div>
                          <span className="label">Expression</span>
                          <Segmented options={['happy', 'neutral', 'love'] as RealisticMood[]} value={realLook.mood} onChange={(v) => setReal({ mood: v })} />
                        </div>
                      </>
                    )}
                    <div>
                      <span className="label">Framing</span>
                      <Segmented options={['upper', 'head'] as RealisticLook['framing'][]} value={realLook.framing} onChange={(v) => setReal({ framing: v })} />
                    </div>
                    {realisticModel(realLook.model).kind === 'photo' ? (
                      <p className="text-[11px] leading-snug text-slate-400">Animated photo portrait · your image</p>
                    ) : <p className="text-[11px] leading-snug text-slate-400">
                      3D: <a className="underline" href="https://github.com/met4citizen/TalkingHead" target="_blank" rel="noreferrer">TalkingHead</a> by Mika Suominen (MIT) · model: {realisticModel(realLook.model).credit}
                    </p>}
                <div>
                  <span className="label">Size on screen</span>
                  <Segmented options={['sm', 'md', 'lg'] as CharacterSize[]} value={look.size} onChange={(v) => set('size', v)} />
                </div>
                <button className="btn-link" onClick={resetPos}>Move back to the corner</button>
                <p className="text-xs text-slate-400">Tip: right-click or long-press the character to open this editor.</p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function NamedSwatches({ label, options, value, onChange }: {
  label: string; options: { v: string; n: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.v} type="button" title={o.n} aria-label={o.n} aria-pressed={value === o.v} onClick={() => onChange(o.v)}
            className={`h-8 w-8 rounded-full ring-1 ring-black/10 transition duration-300 active:scale-90 ${value === o.v ? 'outline outline-2 outline-offset-2 outline-brand-500' : ''}`}
            style={{ background: o.v === '#ffffff' ? 'conic-gradient(#f4d7c4, #c9a27e, #8c6a55, #f4d7c4)' : o.v }} />
        ))}
      </div>
    </div>
  )
}

function ToolButton({ label, onClick, children, disabled, tone }: {
  label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; tone?: 'primary' | 'danger'
}) {
  const color = tone === 'primary' ? 'bg-brand-500 text-white hover:bg-brand-600' : tone === 'danger' ? 'bg-rose-500 text-white hover:bg-rose-600' : 'text-slate-700 hover:bg-slate-900/[0.06]'
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
const IconPencil = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8 18.5 4 20l1.5-4z" /></svg>)
const IconPhoneDown = () => (<svg viewBox="0 0 24 24" className={svgIcon} fill="currentColor" aria-hidden><path d="M12 9c-3.2 0-6.2.9-8.6 2.6-.6.4-.8 1.2-.5 1.9l1 2c.3.6 1 .9 1.7.7l2.6-.9c.6-.2 1-.8 1-1.4v-1.6a12 12 0 0 1 5.6 0v1.6c0 .6.4 1.2 1 1.4l2.6.9c.7.2 1.4-.1 1.7-.7l1-2c.3-.7.1-1.5-.5-1.9C18.2 9.9 15.2 9 12 9z" /></svg>)

function Segmented<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-full bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o}
          className={`rounded-full px-3 py-1 text-xs capitalize transition-all duration-300 ${value === o ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}
