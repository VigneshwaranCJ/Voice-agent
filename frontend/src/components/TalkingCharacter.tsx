/**
 * Talking character: the voice agent's on-screen body.
 *
 * - Tap / Enter starts a call (replaces the "Start" button); during a call, tap toggles mute.
 * - Drag it anywhere (or focus it and use the arrow keys); position is remembered.
 * - Edit its look (skin, hair, outfit, accessory, name, size); saved per agent.
 * - Acts on the voice: lip-syncs to the agent's audio loudness, leans in and pulses while the caller
 *   talks, looks up with a hand on the chin while thinking, waves when idle or saying goodbye, and
 *   reacts with surprise to an interruption.
 *
 * Animation runs in one requestAnimationFrame loop that writes SVG attributes directly, so speaking
 * at 60 fps never re-renders React.
 */

import { createRef, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentState } from '../services/voiceClient'
import {
  DEFAULT_MANGA, LIPSYNC_MOUTHS, MOUTH, MangaEditor, MangaFaceAvatar, mouthUrl, preloadMouths, type MangaLook,
} from './MangaFaceAvatar'
import RealisticAvatar, {
  DEFAULT_REALISTIC, REAL_HAIR, REAL_OUTFIT, REAL_SKIN, type RealisticDriver, type RealisticLook, type RealisticMood,
} from './RealisticAvatar'

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'none'
export type Accessory = 'headset' | 'glasses' | 'none'
export type CharacterSize = 'sm' | 'md' | 'lg'
export type Reaction = 'surprised' | 'concerned' | 'goodbye' | null

export type CharacterStyle = 'realistic' | 'manga' | 'classic'

export interface CharacterLook {
  name: string
  style: CharacterStyle
  manga: MangaLook
  realistic: RealisticLook
  skin: string
  hairStyle: HairStyle
  hairColor: string
  outfit: string
  accessory: Accessory
  size: CharacterSize
}

export const DEFAULT_LOOK: CharacterLook = {
  name: 'Assistant', style: 'realistic', manga: DEFAULT_MANGA, realistic: DEFAULT_REALISTIC, skin: '#c68863', hairStyle: 'long', hairColor: '#2b1d16', outfit: '#4f46e5',
  accessory: 'headset', size: 'md',
}

const SKINS = ['#f3d2b8', '#e0ac85', '#c68863', '#9b6544', '#6e4430']
const HAIR_COLORS = ['#1b1210', '#2b1d16', '#6b3f1f', '#a8752f', '#9ca3af']
const OUTFITS = ['#4f46e5', '#0f766e', '#be123c', '#0369a1', '#334155', '#ca8a04']
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

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

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

  // ---- animation loop --------------------------------------------------------------------------------
  const r = {
    body: useRef<SVGGElement>(null), head: useRef<SVGGElement>(null), eyes: useRef<SVGGElement>(null),
    pupils: useRef<SVGGElement>(null), mouth: useRef<SVGEllipseElement>(null), brows: useRef<SVGGElement>(null),
    armL: useRef<SVGGElement>(null), armR: useRef<SVGGElement>(null), ring: useRef<SVGCircleElement>(null),
    dots: useRef<SVGGElement>(null), shadow: useRef<SVGEllipseElement>(null),
  }
  const mf = {
    head: useRef<HTMLDivElement>(null), body: useRef<HTMLDivElement>(null), eyes: useRef<HTMLDivElement>(null),
    brows: useRef<HTMLDivElement>(null), mouth: useRef<HTMLImageElement>(null),
  }
  const previewManga = useMemo(() => ({
    head: createRef<HTMLDivElement>(), body: createRef<HTMLDivElement>(), eyes: createRef<HTMLDivElement>(),
    brows: createRef<HTMLDivElement>(), mouth: createRef<HTMLImageElement>(),
  }), [])
  const previewSvg = useMemo(() => ({
    body: createRef<SVGGElement>(), head: createRef<SVGGElement>(), eyes: createRef<SVGGElement>(), pupils: createRef<SVGGElement>(),
    mouth: createRef<SVGEllipseElement>(), brows: createRef<SVGGElement>(), armL: createRef<SVGGElement>(), armR: createRef<SVGGElement>(),
    ring: createRef<SVGCircleElement>(), dots: createRef<SVGGElement>(), shadow: createRef<SVGEllipseElement>(),
  }), [])
  const live_ = useRef({ state, reaction, muted, look })
  live_.current = { state, reaction, muted, look }
  useEffect(() => { if (look.style === 'manga') preloadMouths(look.manga.skin) }, [look.style, look.manga.skin])
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

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const m = reduce ? 0.25 : 1 // motion scale
    const cur = { mouth: 0, tilt: 0, lean: 0, armL: 0, armR: 0, gx: 0, gy: 0, brow: 0, ring: 0, eyeOpen: 1 }
    let nextBlink = performance.now() + 2500
    let blinkUntil = 0
    let raf = 0
    const start = performance.now()

    const frame = (now: number) => {
      const t = (now - start) / 1000
      const { state: s, reaction: rx } = live_.current
      const { mic, agent } = levelsRef.current()
      const speaking = s === 'speaking'

      // targets per state
      let tilt = 0, lean = 0, armL = 0, armR = 0, gx = 0, gy = 0, brow = 0
      let mouth = speaking ? agent : 0
      if (s === 'listening') {
        tilt = -6; lean = 3; brow = 1.5
        gx = -1.5
      } else if (s === 'thinking') {
        tilt = 8; gx = 3; gy = -3.5; armR = 100; brow = 2 // hand up to the chin, eyes up
      } else if (speaking) {
        // open-palm gestures outward, bigger when the voice is louder
        armL = 14 + agent * 35 * Math.abs(Math.sin(t * 2.2))
        armR = -12 - agent * 30 * Math.abs(Math.sin(t * 1.7 + 1))
      } else if (s === 'connecting') {
        gx = Math.sin(t * 2) * 3
      } else if (!s || s === 'ended') {
        // idle: wave for ~1.4 s every 7 s
        const phase = t % 7
        if (phase < 1.4 && m === 1) armR = -150 + Math.sin(phase * 12) * 22
        else gx = Math.sin(t * 0.7) * 1.5
      }
      if (rx === 'surprised') { brow = 5; mouth = Math.max(mouth, 0.55); lean = -3 }
      if (rx === 'concerned') { brow = -2.5; tilt = 5 }
      if (rx === 'goodbye' && m === 1) armR = -150 + Math.sin(t * 12) * 22

      const k = 0.18
      cur.mouth = lerp(cur.mouth, mouth, speaking ? 0.55 : 0.25)
      cur.tilt = lerp(cur.tilt, tilt * m, k * 0.6)
      cur.lean = lerp(cur.lean, lean * m, k * 0.6)
      cur.armL = lerp(cur.armL, armL, k)
      cur.armR = lerp(cur.armR, armR, k)
      cur.gx = lerp(cur.gx, gx, k); cur.gy = lerp(cur.gy, gy, k)
      cur.brow = lerp(cur.brow, brow, k)
      cur.ring = lerp(cur.ring, s === 'listening' ? Math.min(1, mic * 6) : 0, 0.3)

      // blink
      if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2200 + Math.random() * 3500 }
      const eyeOpen = rx === 'surprised' ? 1.25 : now < blinkUntil ? 0.08 : s === 'ended' ? 0.85 : 1
      cur.eyeOpen = lerp(cur.eyeOpen, eyeOpen, 0.5)

      const breathe = Math.sin(t * 2) * 1.4 * m
      const talkBob = speaking ? Math.sin(t * 9) * cur.mouth * 3 * m : 0
      const nod = s === 'listening' && mic > 0.04 ? Math.sin(t * 7) * 1.5 * m : 0

      r.body.current?.setAttribute('transform', `translate(0 ${breathe.toFixed(2)})`)
      r.head.current?.setAttribute('transform',
        `translate(${cur.lean.toFixed(2)} ${(talkBob + nod - cur.mouth * 1.5).toFixed(2)}) rotate(${(cur.tilt + talkBob * 0.6).toFixed(2)} 100 92)`)
      r.eyes.current?.setAttribute('transform', `translate(0 88) scale(1 ${cur.eyeOpen.toFixed(3)}) translate(0 -88)`)
      r.pupils.current?.setAttribute('transform', `translate(${cur.gx.toFixed(2)} ${cur.gy.toFixed(2)})`)
      r.brows.current?.setAttribute('transform', `translate(0 ${(-cur.brow).toFixed(2)})`)
      r.armL.current?.setAttribute('transform', `rotate(${cur.armL.toFixed(2)} 66 150)`)
      r.armR.current?.setAttribute('transform', `rotate(${cur.armR.toFixed(2)} 134 150)`)
      const mo = cur.mouth
      r.mouth.current?.setAttribute('ry', (1.6 + mo * 9).toFixed(2))
      r.mouth.current?.setAttribute('rx', (8 - mo * 1.5).toFixed(2))
      if (r.ring.current) {
        r.ring.current.setAttribute('r', (62 + cur.ring * 10).toFixed(2))
        r.ring.current.setAttribute('opacity', (cur.ring * 0.7).toFixed(3))
      }
      if (r.dots.current) {
        r.dots.current.setAttribute('opacity', s === 'thinking' ? '1' : '0')
        Array.from(r.dots.current.children).forEach((c, i) =>
          c.setAttribute('opacity', (0.3 + 0.7 * Math.max(0, Math.sin(t * 5 - i * 0.9))).toFixed(2)))
      }
      r.shadow.current?.setAttribute('rx', (46 - breathe).toFixed(2))

      // MangaFace: same motion, applied to the PNG layers; lip-sync swaps between mouth drawings.
      if (mf.head.current) {
        const ml = live_.current.look.manga
        mf.body.current!.style.transform = `translateY(${breathe.toFixed(2)}px)`
        mf.head.current.style.transform =
          `translate(${cur.lean.toFixed(2)}px, ${(breathe + talkBob + nod - cur.mouth * 1.5).toFixed(2)}px) rotate(${(cur.tilt * 0.7 + talkBob * 0.5).toFixed(2)}deg)`
        mf.eyes.current!.style.transform = `scaleY(${Math.min(1.15, cur.eyeOpen).toFixed(3)})`
        mf.brows.current!.style.transform = `translateY(${(-cur.brow).toFixed(2)}px)`
        let mouthN = ml.mouth
        if (rx === 'surprised') mouthN = MOUTH.surprised
        else if (speaking) {
          const v = cur.mouth
          mouthN = LIPSYNC_MOUTHS[v < 0.06 ? 0 : v < 0.2 ? 1 : v < 0.4 ? 2 : v < 0.65 ? 3 : 4]
        } else if (s === 'listening') mouthN = MOUTH.listening
        else if (s === 'thinking') mouthN = MOUTH.thinking
        const img = mf.mouth.current!
        const key = `${ml.skin}/${mouthN}`
        if (img.dataset.key !== key) { img.dataset.key = key; img.src = mouthUrl(ml.skin, mouthN) }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        {look.style === 'realistic' ? (
          <div className="relative">
            <RealisticAvatar look={realLook} driver={realDriver} width={size * 1.15} height={size * 1.25} className="-mx-[7.5%]" />
            {live && <span className={`absolute bottom-3 right-4 h-3 w-3 rounded-full ring-2 ring-white ${muted ? 'bg-rose-500' : 'bg-emerald-400'}`} />}
            {state === 'thinking' && <span className="absolute right-3 top-2 animate-pulse text-2xl text-slate-400">…</span>}
            {state === 'listening' && <span className="pointer-events-none absolute inset-x-[10%] bottom-0 h-1 animate-pulse rounded-full bg-emerald-400/70" />}
          </div>
        ) : look.style === 'manga' ? (
          <div className="relative">
            <MangaFaceAvatar look={look.manga} refs={mf} width={size} />
            {live && <span className={`absolute bottom-2 right-3 h-3 w-3 rounded-full ring-2 ring-white ${muted ? 'bg-rose-500' : 'bg-emerald-400'}`} />}
            {state === 'thinking' && <span className="absolute -top-1 right-2 animate-pulse text-2xl text-slate-400">…</span>}
            {state === 'listening' && <span className="pointer-events-none absolute inset-0 animate-ping rounded-full ring-4 ring-emerald-300/50" style={{ animationDuration: '1.6s' }} />}
          </div>
        ) : (
          <CharacterSvg look={look} r={r} muted={!!muted} live={live} />
        )}
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
                  {look.style === 'realistic'
                    ? <RealisticAvatar look={realLook} width={220} height={260} />
                    : look.style === 'manga'
                    ? <MangaFaceAvatar look={look.manga} refs={previewManga} width={200} />
                    : <div style={{ width: 200 }}><CharacterSvg look={look} r={previewSvg} muted={false} live={false} /></div>}
                </div>
                <input aria-label="Character name" className="w-56 bg-transparent text-center text-2xl font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
                  value={look.name} maxLength={24} placeholder="Name" onChange={(e) => set('name', e.target.value)} />
                <div className="inline-flex rounded-full bg-slate-200/70 p-1">
                  {(['realistic', 'manga', 'classic'] as CharacterStyle[]).map((st) => (
                    <button key={st} onClick={() => set('style', st)} aria-pressed={look.style === st}
                      className={`rounded-full px-4 py-1 text-sm capitalize transition-all duration-300 ${look.style === st ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600'}`}>{st}</button>
                  ))}
                </div>
              </div>
              {/* controls */}
              <div className="min-h-0 space-y-4 overflow-y-auto p-6 text-sm">
                {look.style === 'realistic' ? (
                  <>
                    <NamedSwatches label="Skin tone" options={REAL_SKIN} value={realLook.skin} onChange={(v) => setReal({ skin: v })} />
                    <NamedSwatches label="Hair colour" options={REAL_HAIR} value={realLook.hair} onChange={(v) => setReal({ hair: v })} />
                    <NamedSwatches label="Outfit" options={REAL_OUTFIT} value={realLook.outfit} onChange={(v) => setReal({ outfit: v })} />
                    <div>
                      <span className="label">Expression</span>
                      <Segmented options={['happy', 'neutral', 'love'] as RealisticMood[]} value={realLook.mood} onChange={(v) => setReal({ mood: v })} />
                    </div>
                    <div>
                      <span className="label">Framing</span>
                      <Segmented options={['upper', 'head'] as RealisticLook['framing'][]} value={realLook.framing} onChange={(v) => setReal({ framing: v })} />
                    </div>
                    <p className="text-[11px] leading-snug text-slate-400">
                      3D: <a className="underline" href="https://github.com/met4citizen/TalkingHead" target="_blank" rel="noreferrer">TalkingHead</a> by Mika Suominen (MIT) · model made with MPFB/MakeHuman (CC0)
                    </p>
                  </>
                ) : look.style === 'manga' ? (
                  <>
                    <MangaEditor look={look.manga} onChange={(v) => set('manga', v)} />
                    <p className="text-[11px] leading-snug text-slate-400">
                      Art: <a className="underline" href="https://github.com/miladnia/MangaFace" target="_blank" rel="noreferrer">MangaFace</a> by Milad Abdollahnia (MIT)
                    </p>
                  </>
                ) : (
                  <>
                    <Swatches label="Skin" options={SKINS} value={look.skin} onChange={(v) => set('skin', v)} />
                    <div>
                      <span className="label">Hair</span>
                      <Segmented options={['short', 'long', 'bun', 'curly', 'none'] as HairStyle[]} value={look.hairStyle} onChange={(v) => set('hairStyle', v)} />
                    </div>
                    {look.hairStyle !== 'none' && <Swatches label="Hair colour" options={HAIR_COLORS} value={look.hairColor} onChange={(v) => set('hairColor', v)} />}
                    <Swatches label="Outfit" options={OUTFITS} value={look.outfit} onChange={(v) => set('outfit', v)} />
                    <div>
                      <span className="label">Accessory</span>
                      <Segmented options={['headset', 'glasses', 'none'] as Accessory[]} value={look.accessory} onChange={(v) => set('accessory', v)} />
                    </div>
                  </>
                )}
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

function Swatches({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((c) => (
          <button key={c} aria-label={`${label} ${c}`} aria-pressed={value === c} onClick={() => onChange(c)}
            className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ${value === c ? 'ring-brand-500' : 'ring-transparent'}`} style={{ background: c }} />
        ))}
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
      </div>
    </div>
  )
}

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

type Refs = {
  body: React.RefObject<SVGGElement | null>; head: React.RefObject<SVGGElement | null>; eyes: React.RefObject<SVGGElement | null>
  pupils: React.RefObject<SVGGElement | null>; mouth: React.RefObject<SVGEllipseElement | null>; brows: React.RefObject<SVGGElement | null>
  armL: React.RefObject<SVGGElement | null>; armR: React.RefObject<SVGGElement | null>; ring: React.RefObject<SVGCircleElement | null>
  dots: React.RefObject<SVGGElement | null>; shadow: React.RefObject<SVGEllipseElement | null>
}

/** Original character artwork. Coordinates: 200 × 250 viewBox, head centre (100, 88). */
function CharacterSvg({ look, r, muted, live }: { look: CharacterLook; r: Refs; muted: boolean; live: boolean }) {
  const { skin, hairColor: hair, outfit, hairStyle, accessory } = look
  const shade = 'rgba(0,0,0,0.12)'
  return (
    <svg viewBox="0 0 200 250" className="block h-auto w-full overflow-visible drop-shadow-md" aria-hidden="true">
      <ellipse ref={r.shadow} cx="100" cy="243" rx="46" ry="6" fill="rgba(15,23,42,0.15)" />
      <circle ref={r.ring} cx="100" cy="92" r="62" fill="none" stroke="#10b981" strokeWidth="4" opacity="0" />

      <g ref={r.body}>
        {/* arms (behind torso) */}
        <g ref={r.armL}>
          <path d="M66 150 C52 170 48 192 52 212" stroke={outfit} strokeWidth="16" strokeLinecap="round" fill="none" />
          <circle cx="52" cy="214" r="9" fill={skin} />
        </g>
        <g ref={r.armR}>
          <path d="M134 150 C148 170 152 192 148 212" stroke={outfit} strokeWidth="16" strokeLinecap="round" fill="none" />
          <circle cx="148" cy="214" r="9" fill={skin} />
        </g>
        {/* torso */}
        <path d="M58 240 C58 178 72 146 100 146 C128 146 142 178 142 240 Z" fill={outfit} />
        <path d="M86 146 L100 166 L114 146 Z" fill={skin} />
        <path d="M58 240 C58 200 62 182 70 168" stroke={shade} strokeWidth="6" fill="none" />
        {live && <circle cx="122" cy="178" r="4" fill={muted ? '#f43f5e' : '#34d399'} />}

        {/* head */}
        <g ref={r.head}>
          <rect x="91" y="120" width="18" height="22" rx="6" fill={skin} />
          {hairStyle === 'long' && <path d="M58 86 C56 40 144 40 142 86 L146 150 C130 156 70 156 54 150 Z" fill={hair} />}
          {hairStyle === 'bun' && <circle cx="100" cy="34" r="16" fill={hair} />}
          <ellipse cx="60" cy="94" rx="7" ry="10" fill={skin} />
          <ellipse cx="140" cy="94" rx="7" ry="10" fill={skin} />
          <ellipse cx="100" cy="90" rx="40" ry="44" fill={skin} />
          {hairStyle === 'short' && <path d="M60 84 C58 46 142 44 140 84 C134 66 118 58 100 60 C82 58 66 66 60 84 Z" fill={hair} />}
          {hairStyle === 'long' && <path d="M60 86 C58 44 142 44 140 86 C128 62 110 56 98 58 C84 60 70 68 60 86 Z" fill={hair} />}
          {hairStyle === 'bun' && <path d="M60 82 C60 48 140 48 140 82 C126 62 74 62 60 82 Z" fill={hair} />}
          {hairStyle === 'curly' && (
            <g fill={hair}>
              {[62, 74, 88, 102, 116, 128, 138].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 54 : 62} r="13" />)}
              <circle cx="60" cy="76" r="9" /><circle cx="140" cy="76" r="9" />
            </g>
          )}

          {/* brows */}
          <g ref={r.brows} stroke={hairStyle === 'none' ? '#3f2a1e' : hair} strokeWidth="3.5" strokeLinecap="round">
            <path d="M76 72 Q84 68 92 71" fill="none" />
            <path d="M108 71 Q116 68 124 72" fill="none" />
          </g>
          {/* eyes */}
          <g ref={r.eyes}>
            <ellipse cx="84" cy="88" rx="7.5" ry="8.5" fill="#fff" />
            <ellipse cx="116" cy="88" rx="7.5" ry="8.5" fill="#fff" />
            <g ref={r.pupils} fill="#1e1b2e">
              <circle cx="84" cy="89" r="4.5" /><circle cx="116" cy="89" r="4.5" />
              <circle cx="85.5" cy="87.5" r="1.4" fill="#fff" /><circle cx="117.5" cy="87.5" r="1.4" fill="#fff" />
            </g>
          </g>
          <ellipse cx="74" cy="104" rx="6" ry="3.5" fill="#f87171" opacity="0.25" />
          <ellipse cx="126" cy="104" rx="6" ry="3.5" fill="#f87171" opacity="0.25" />
          <path d="M100 92 Q97 101 101 103" stroke={shade} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* mouth: ry/rx driven by the agent's voice */}
          <ellipse ref={r.mouth} cx="100" cy="114" rx="8" ry="1.6" fill="#7f1d1d" />

          {accessory === 'glasses' && (
            <g stroke="#1f2937" strokeWidth="2.5" fill="rgba(255,255,255,0.15)">
              <circle cx="84" cy="88" r="12" /><circle cx="116" cy="88" r="12" /><path d="M96 88 L104 88" />
            </g>
          )}
          {accessory === 'headset' && (
            <g>
              <path d="M58 92 C54 30 146 30 142 92" stroke="#1f2937" strokeWidth="5" fill="none" />
              <rect x="50" y="82" width="12" height="22" rx="5" fill="#1f2937" />
              <rect x="138" y="82" width="12" height="22" rx="5" fill="#1f2937" />
              <path d="M56 102 C60 122 74 124 86 118" stroke="#1f2937" strokeWidth="3" fill="none" />
              <circle cx="88" cy="117" r="4" fill={muted ? '#f43f5e' : '#1f2937'} />
            </g>
          )}
        </g>

        {/* thinking dots */}
        <g ref={r.dots} opacity="0" fill="#94a3b8">
          <circle cx="146" cy="44" r="4" /><circle cx="158" cy="32" r="5" /><circle cx="172" cy="18" r="6" />
        </g>
      </g>
    </svg>
  )
}
