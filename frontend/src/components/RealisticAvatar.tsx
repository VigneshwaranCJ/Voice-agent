/**
 * Realistic 3D woman avatar.
 *
 * Renderer: TalkingHead by Mika Suominen (MIT), https://github.com/met4citizen/TalkingHead
 * Model:    `mpfb.glb` from the TalkingHead repo, made with Blender + MPFB (MakeHuman), CC0.
 *           Textures were downscaled to 1024 px to keep the download near 20 MB.
 *
 * Lip-sync is driven from the agent audio's loudness (we have no word timings from streaming TTS):
 * every ~90 ms a new mouth shape (Oculus viseme) is picked and scaled by the loudness, with the jaw
 * following. States and reactions map to TalkingHead moods, gaze and hand gestures.
 */

import { useEffect, useRef, useState } from 'react'
import type { SceneNode, TalkingHead as TalkingHeadT } from '@met4citizen/talkinghead'
import type { AgentState } from '../services/voiceClient'

export const REALISTIC_MODEL_URL = '/avatars/realistic/woman.glb'

export type RealisticMood = 'neutral' | 'happy' | 'love'
export type RealisticFraming = 'head' | 'upper'

export interface RealisticLook {
  mood: RealisticMood
  framing: RealisticFraming
  skin: string
  hair: string
  outfit: string
}

export const DEFAULT_REALISTIC: RealisticLook = { mood: 'happy', framing: 'upper', skin: '#ffffff', hair: '#ffffff', outfit: '#ffffff' }

// Colours multiply the original textures, so '#ffffff' means "as modelled".
export const REAL_SKIN = [
  { v: '#ffffff', n: 'Light' }, { v: '#f0d2bb', n: 'Warm' }, { v: '#d8a982', n: 'Tan' }, { v: '#b07a58', n: 'Brown' }, { v: '#80553c', n: 'Deep' },
]
export const REAL_HAIR = [
  { v: '#ffffff', n: 'Chestnut' }, { v: '#5c4033', n: 'Dark brown' }, { v: '#2a1f1a', n: 'Black' }, { v: '#c46a3a', n: 'Auburn' }, { v: '#e8c48a', n: 'Honey' },
]
export const REAL_OUTFIT = [
  { v: '#ffffff', n: 'Original' }, { v: '#6f9cff', n: 'Blue' }, { v: '#7ccfb6', n: 'Teal' }, { v: '#ff8f8f', n: 'Coral' }, { v: '#b9a6ff', n: 'Lavender' }, { v: '#4a4a4f', n: 'Graphite' },
]

// Matched against glTF material names (three.js rewrites node names, but keeps material names).
const MATERIAL_GROUPS: Record<keyof Pick<RealisticLook, 'skin' | 'hair' | 'outfit'>, string[]> = {
  skin: ['Human.body'],
  hair: ['Human.ponytail01'],
  outfit: ['Human.female_casualsuit01'],
}

const VIEW_OPT: Record<RealisticFraming, Record<string, number>> = {
  head: { cameraDistance: 0.6, cameraY: 0.05 },
  upper: { cameraDistance: -1.2, cameraY: -0.1 },
}
/** Jump the camera to a framing without TalkingHead's eased transition. */
function frame(th: TalkingHeadT, view: RealisticFraming) {
  ;(th as unknown as { cameraClock: number | null }).cameraClock = null
  th.setView(view, VIEW_OPT[view])
}

const VISEMES = ['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'viseme_aa', 'viseme_E', 'viseme_O'] as const
const CLOSERS = ['viseme_PP', 'viseme_FF', 'viseme_nn', 'viseme_DD', 'viseme_SS'] as const
const MOUTH_KEYS = [...new Set([...VISEMES, ...CLOSERS, 'jawOpen'])]

export interface RealisticDriver {
  state: AgentState | null
  reaction: 'surprised' | 'concerned' | 'goodbye' | null
  level: () => number
}

interface Props {
  look: RealisticLook
  width: number
  height: number
  /** Live data read every frame; omit for a static preview. */
  driver?: { current: RealisticDriver }
  className?: string
}

function applyTints(scene: SceneNode | null, look: RealisticLook) {
  if (!scene) return
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      for (const [key, names] of Object.entries(MATERIAL_GROUPS) as [keyof typeof MATERIAL_GROUPS, string[]][]) {
        if (m.name && names.includes(m.name)) m.color?.set(look[key])
      }
    }
  })
}

export default function RealisticAvatar({ look, width, height, driver, className }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const head = useRef<TalkingHeadT | null>(null)
  const scene = useRef<SceneNode | null>(null)
  const lookRef = useRef(look)
  lookRef.current = look
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [progress, setProgress] = useState(0)

  // Create the renderer once.
  useEffect(() => {
    let cancelled = false
    let th: TalkingHeadT | null = null
    ;(async () => {
      try {
        const { TalkingHead } = await import('@met4citizen/talkinghead')
        if (cancelled || !host.current) return
        th = new TalkingHead(host.current, {
          lipsyncModules: [],          // we drive the mouth from audio loudness; no TTS, no word timings
          cameraView: lookRef.current.framing,
          ...VIEW_OPT[lookRef.current.framing],
          cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
          avatarMood: lookRef.current.mood,
          avatarIdleEyeContact: 0.6, avatarSpeakingEyeContact: 0.8,
          lightAmbientIntensity: 2.2, lightDirectIntensity: 25,
          modelFPS: 30,
        })
        await th.showAvatar(
          { url: REALISTIC_MODEL_URL, body: 'F', avatarMood: lookRef.current.mood, lipsyncLang: 'en', baseline: { headRotateX: -0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 } },
          (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total) },
          (gltf) => { scene.current = gltf.scene },
        )
        if (cancelled) { th.dispose(); return }
        applyTints(scene.current, lookRef.current)
        head.current = th
        installDriver(th, driver)
        setStatus('ready')
      } catch (err) {
        console.error('Realistic avatar failed to load', err)
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      head.current = null
      try { th?.dispose() } catch { /* already gone */ }
    }
    // driver is a stable ref object; the renderer is created once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live look changes.
  useEffect(() => { applyTints(scene.current, look) }, [look, status])
  useEffect(() => { if (status === 'ready') try { head.current?.setMood(look.mood) } catch { /* unknown mood */ } }, [look.mood, status])
  useEffect(() => { if (status === 'ready' && head.current) frame(head.current, look.framing) }, [look.framing, status])

  return (
    <div className={`relative ${className ?? ''}`} style={{ width, height }}>
      <div ref={host} className="absolute inset-0 [&_canvas]:pointer-events-none" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-500">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
          <span>{progress > 0 ? `${Math.round(progress * 100)}%` : 'Loading…'}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-rose-600">
          3D avatar could not load (WebGL needed). Pick another style in the editor.
        </div>
      )}
    </div>
  )
}

/** Hooks lip-sync, gaze and gestures into TalkingHead's own animation loop. */
function installDriver(th: TalkingHeadT, driver?: { current: RealisticDriver }) {
  if (!driver) return
  let smooth = 0
  let shape: string = 'viseme_aa'
  let shapeLeft = 0
  let wasSpeaking = false
  let lastState: AgentState | null = null
  let lastReaction: RealisticDriver['reaction'] = null
  const cur: Record<string, number> = Object.fromEntries(MOUTH_KEYS.map((k) => [k, 0]))

  const set = (k: string, v: number | null) => {
    const mt = th.mtAvatar[k]
    if (mt) Object.assign(mt, { realtime: v, needsUpdate: true })
  }

  th.opt.update = (dt: number) => {
    const { state, reaction, level } = driver.current
    const ms = Math.min(dt, 100)

    // ---- state changes: gaze & gestures
    if (state !== lastState) {
      if (state === 'listening') th.makeEyeContact(4000)
      else if (state === 'thinking') th.lookAt(window.innerWidth * 0.75, window.innerHeight * 0.05, 1400)
      else if (state === 'speaking') th.lookAtCamera(2500)
      lastState = state
    }
    if (reaction !== lastReaction) {
      if (reaction === 'goodbye') th.playGesture('handup', 2.5)
      else if (reaction === 'surprised') { th.playGesture('shrug', 1.2) }
      else if (reaction === 'concerned') th.lookAtCamera(3000)
      lastReaction = reaction
    }

    // ---- lip-sync from loudness
    const speaking = state === 'speaking'
    const raw = speaking ? Math.min(1, level()) : 0
    smooth += (raw - smooth) * (raw > smooth ? 0.55 : 0.25)
    if (!speaking && smooth < 0.01) {
      if (wasSpeaking) { MOUTH_KEYS.forEach((k) => set(k, null)); wasSpeaking = false }
      return
    }
    wasSpeaking = true
    shapeLeft -= ms
    if (shapeLeft <= 0) {
      // Mostly vowels; briefly close the lips now and then, like consonants do.
      shape = Math.random() < 0.22 ? CLOSERS[Math.floor(Math.random() * CLOSERS.length)] : VISEMES[Math.floor(Math.random() * VISEMES.length)]
      shapeLeft = 70 + Math.random() * 60
    }
    const amp = Math.min(1, smooth * 1.4)
    for (const k of MOUTH_KEYS) {
      let target = 0
      if (k === shape) target = shape.startsWith('viseme_') && (CLOSERS as readonly string[]).includes(shape) ? 0.6 * Math.min(1, amp * 2) : amp * 0.85
      if (k === 'jawOpen') target = (CLOSERS as readonly string[]).includes(shape) ? amp * 0.05 : amp * 0.22
      cur[k] += (target - cur[k]) * Math.min(1, ms / 45)
      set(k, cur[k] < 0.005 ? 0 : cur[k])
    }
  }
}
