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

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { AgentState } from '../services/voiceClient'

export type HairStyle = 'short' | 'long' | 'bun' | 'curly' | 'none'
export type Accessory = 'headset' | 'glasses' | 'none'
export type CharacterSize = 'sm' | 'md' | 'lg'
export type Reaction = 'surprised' | 'concerned' | 'goodbye' | null

export interface CharacterLook {
  name: string
  skin: string
  hairStyle: HairStyle
  hairColor: string
  outfit: string
  accessory: Accessory
  size: CharacterSize
}

export const DEFAULT_LOOK: CharacterLook = {
  name: 'Assistant', skin: '#c68863', hairStyle: 'long', hairColor: '#2b1d16', outfit: '#4f46e5',
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
  const clamp = useCallback((p: { x: number; y: number }) => ({
    x: Math.max(8, Math.min(window.innerWidth - size - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - size * 1.25 - 8, p.y)),
  }), [size])
  const [pos, setPos] = useState(() => loadPos(posKey) ?? { x: window.innerWidth - size - 40, y: window.innerHeight - size * 1.3 - 40 })
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)

  useEffect(() => { setPos((p) => clamp(p)) }, [clamp])
  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clamp])
  const savePos = (p: { x: number; y: number }) => { try { localStorage.setItem(posKey, JSON.stringify(p)) } catch { /* private mode */ } }

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, sx: e.clientX, sy: e.clientY, moved: false }
  }
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
    d.moved = true
    setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }))
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) savePos(pos)
    else if (!disabled) onActivate()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 60 : 20
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key]) {
      e.preventDefault()
      const p = clamp({ x: pos.x + moves[e.key][0], y: pos.y + moves[e.key][1] })
      setPos(p); savePos(p)
    } else if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
      e.preventDefault(); onActivate()
    }
  }

  // ---- animation loop --------------------------------------------------------------------------------
  const r = {
    body: useRef<SVGGElement>(null), head: useRef<SVGGElement>(null), eyes: useRef<SVGGElement>(null),
    pupils: useRef<SVGGElement>(null), mouth: useRef<SVGEllipseElement>(null), brows: useRef<SVGGElement>(null),
    armL: useRef<SVGGElement>(null), armR: useRef<SVGGElement>(null), ring: useRef<SVGCircleElement>(null),
    dots: useRef<SVGGElement>(null), shadow: useRef<SVGEllipseElement>(null),
  }
  const live_ = useRef({ state, reaction, muted })
  live_.current = { state, reaction, muted }
  const levelsRef = useRef(levels)
  levelsRef.current = levels

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
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- editor ----------------------------------------------------------------------------------------
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])
  const set = <K extends keyof CharacterLook>(k: K, v: CharacterLook[K]) => onLookChange({ ...look, [k]: v })

  const status = disabled ? 'Pick an agent first'
    : !state || state === 'ended' ? `Tap me to talk to ${look.name}`
      : state === 'connecting' ? 'Connecting…'
        : muted ? 'Muted — tap me to unmute'
          : state === 'listening' ? "I'm listening…"
            : state === 'thinking' ? 'Let me check…'
              : caption || '…'

  const bubbleLeft = pos.x + size / 2 > window.innerWidth / 2
  return (
    <div className="pointer-events-none fixed z-40 select-none" style={{ left: pos.x, top: pos.y, width: size }}>
      {/* speech bubble */}
      <div className={`pointer-events-auto absolute bottom-full mb-1 w-64 rounded-2xl bg-white px-3 py-2 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200 ${bubbleLeft ? 'right-1/3' : 'left-1/3'}`}
        aria-live="polite">
        <span className="line-clamp-3">{status}</span>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={live ? `${look.name}: ${status}. Press Enter to ${muted ? 'unmute' : 'mute'}. Arrow keys move.` : `Start a voice call with ${look.name}. Arrow keys move.`}
        aria-disabled={disabled}
        className={`pointer-events-auto touch-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null }}
        onKeyDown={onKeyDown}
      >
        <CharacterSvg look={look} r={r} muted={!!muted} live={live} />
      </div>

      {/* controls */}
      <div className="pointer-events-auto mt-1 flex justify-center gap-1">
        <button className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow ring-1 ring-slate-200 hover:bg-slate-50"
          onClick={() => setEditing((v) => !v)} aria-expanded={editing}>Edit</button>
        {live && onEnd && (
          <button className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-medium text-white shadow hover:bg-rose-700" onClick={onEnd}>End call</button>
        )}
      </div>

      {editing && (
        <div className={`pointer-events-auto absolute max-h-[80vh] w-72 space-y-3 overflow-y-auto rounded-xl bg-white p-4 text-sm shadow-xl ring-1 ring-slate-200 ${bubbleLeft ? 'right-0' : 'left-0'} ${pos.y > 460 ? 'bottom-full mb-16' : 'top-full mt-2'}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800">Customise character</span>
            <button className="text-slate-400 hover:text-slate-600" onClick={() => setEditing(false)} aria-label="Close editor">✕</button>
          </div>
          <label className="block">
            <span className="label">Name</span>
            <input className="input" value={look.name} maxLength={24} onChange={(e) => set('name', e.target.value)} />
          </label>
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
          <div>
            <span className="label">Size</span>
            <Segmented options={['sm', 'md', 'lg'] as CharacterSize[]} value={look.size} onChange={(v) => set('size', v)} />
          </div>
          <div className="flex justify-between pt-1">
            <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => onLookChange({ ...DEFAULT_LOOK, name: look.name })}>Reset look</button>
            <button className="text-xs text-slate-500 hover:text-slate-700" onClick={() => {
              const p = clamp({ x: window.innerWidth - size - 40, y: window.innerHeight - size * 1.3 - 40 })
              setPos(p); savePos(p)
            }}>Reset position</button>
          </div>
        </div>
      )}
    </div>
  )
}

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
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} aria-pressed={value === o}
          className={`rounded-md px-2 py-1 text-xs capitalize ring-1 ${value === o ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}>
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
